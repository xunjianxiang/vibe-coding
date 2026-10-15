import type { PrismaClient, Workspace } from "@prisma/client";
import Docker from "dockerode";
import { finished } from "node:stream/promises";
import { writeContainerInventory, type ContainerInventoryEntry } from "@/lib/container-inventory";
import { normalizeStartupLogMessage } from "@/lib/log-output";
import {
  ACTIVE_WORKSPACE_STATUSES,
  CODEX_HOME_CONTAINER_PATH,
  CODEX_SQLITE_HOME_CONTAINER_PATH,
  ORPHAN_CONTAINER_GRACE_MS,
  hasWorkspaceError,
  workspaceErrorCode,
  workspaceIdleDeadline,
} from "@/lib/workspace-policy";
import { hashDevcontainerDirectory } from "@/runner/devcontainer-hash";
import { appendWorkspaceLog, hasWorkspaceServiceCatalog, readWorkspaceServices } from "@/runner/logs";
import { run, runDevcontainerStreaming, type ProcessOutputLine } from "@/runner/process";
import { validateContainerConfig } from "@/runner/security";
import { loadProcessServices, registerProcessServices, syncProcessServiceLogs } from "@/runner/services";
import { reconcileServiceOperations } from "@/runner/service-operations";
import { closeWorkspaceTerminals, hasActiveWorkspaceTerminalRuntime } from "@/runner/terminal-gateway";
import { publishToUser } from "@/runner/realtime-hub";
import { applyUnexpectedContainerStopped } from "@/runner/workspace-state";

const docker = new Docker();
const suspiciousContainerSince = new Map<string, number>();

type DevcontainerConfig = {
  mergedConfiguration?: { remoteUser?: string; workspaceFolder?: string };
  workspace?: { workspaceFolder?: string };
};

type DevcontainerUpResult = {
  outcome: "success" | "error";
  containerId?: string;
  remoteUser?: string;
  remoteWorkspaceFolder?: string;
  message?: string;
  description?: string;
};

type ManagedContainer = Docker.ContainerInfo & {
  Labels: Record<string, string>;
};

async function listManagedContainers() {
  return await docker.listContainers({ all: true, filters: { label: ["platform.managed=true"] } }) as ManagedContainer[];
}

function isRunningContainer(container: ManagedContainer) {
  return container.State === "running";
}

async function stopOwnedContainer(containerId: string, workspaceId?: string, composeProject?: string | null) {
  const container = docker.getContainer(containerId);
  const inspected = await container.inspect().catch(() => null);
  if (!inspected) return;
  const labels = inspected.Config.Labels ?? {};
  const platformOwned = labels["platform.managed"] === "true" && (!workspaceId || labels["platform.workspace_id"] === workspaceId);
  const composeOwned = !!composeProject && labels["com.docker.compose.project"] === composeProject;
  if (!platformOwned && !composeOwned) {
    throw new Error(`Refusing to stop container ${containerId} with mismatched Workspace ownership.`);
  }
  if (inspected.State.Running) await container.stop({ t: 10 });
}

async function reconcileContainerInventory(db: PrismaClient) {
  const [containers, workspaces, leases] = await Promise.all([
    listManagedContainers(),
    db.workspace.findMany({ select: { id: true, projectId: true, containerId: true, status: true, desiredState: true, error: true } }),
    db.lease.findMany({ select: { projectId: true, workspaceId: true } }),
  ]);
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const leaseWorkspaceByProject = new Map(leases.map((lease) => [lease.projectId, lease.workspaceId]));
  const runningByProject = new Map<string, ManagedContainer[]>();
  for (const container of containers) {
    const projectId = container.Labels["platform.project_id"];
    if (!projectId || !isRunningContainer(container)) continue;
    runningByProject.set(projectId, [...(runningByProject.get(projectId) ?? []), container]);
  }
  const conflictProjectIds = [...runningByProject.entries()].filter(([, values]) => values.length > 1).map(([projectId]) => projectId);
  const conflictProjects = new Set(conflictProjectIds);
  const now = Date.now();
  const inventory: ContainerInventoryEntry[] = [];
  const stoppedContainerDetails = new Map(await Promise.all(
    containers
      .filter((container) => !isRunningContainer(container))
      .map(async (container) => [container.Id, await docker.getContainer(container.Id).inspect().catch(() => null)] as const),
  ));

  for (const container of containers) {
    const workspaceId = container.Labels["platform.workspace_id"] || null;
    const projectId = container.Labels["platform.project_id"] || null;
    const workspace = workspaceId ? workspaceById.get(workspaceId) : undefined;
    const stoppedDetails = stoppedContainerDetails.get(container.Id);
    let anomaly: ContainerInventoryEntry["anomaly"] = null;
    if (!workspace) anomaly = "ORPHAN";
    else if (!projectId || workspace.projectId !== projectId) anomaly = "OWNERSHIP_CONFLICT";
    else if (isRunningContainer(container) && conflictProjects.has(projectId)) anomaly = "PROJECT_CONFLICT";
    else if (workspace.containerId && workspace.containerId !== container.Id && isRunningContainer(container)) anomaly = "ORPHAN";

    inventory.push({
      id: container.Id,
      name: container.Names[0]?.replace(/^\//, "") ?? null,
      workspaceId,
      projectId,
      expectedProjectId: workspace?.projectId ?? null,
      expectedRunning: workspace?.desiredState === "RUNNING" && !["STOPPED", "DELETED"].includes(workspace.status),
      state: container.State,
      running: isRunningContainer(container),
      exitCode: stoppedDetails?.State.ExitCode ?? null,
      finishedAt: stoppedDetails?.State.FinishedAt && !stoppedDetails.State.FinishedAt.startsWith("0001-")
        ? stoppedDetails.State.FinishedAt
        : null,
      oomKilled: stoppedDetails?.State.OOMKilled ?? false,
      dead: stoppedDetails?.State.Dead ?? false,
      error: stoppedDetails?.State.Error || null,
      anomaly,
    });
    if (workspace && anomaly === "OWNERSHIP_CONFLICT") {
      await db.workspace.updateMany({
        where: { id: workspace.id, status: { in: [...ACTIVE_WORKSPACE_STATUSES] } },
        data: { status: "ERROR", error: `${workspaceErrorCode.ownership}: Docker labels do not match the Workspace project.` },
      });
    }
    if (workspace && anomaly === "PROJECT_CONFLICT") {
      await db.workspace.updateMany({
        where: { id: workspace.id, status: { in: [...ACTIVE_WORKSPACE_STATUSES] } },
        data: { status: "ERROR", error: `${workspaceErrorCode.conflict}: Multiple active primary containers were found for this project.` },
      });
    }

    const candidateWorkspaceId = projectId ? leaseWorkspaceByProject.get(projectId) : null;
    const shouldQuarantine = anomaly === "ORPHAN" || anomaly === "OWNERSHIP_CONFLICT"
      || (anomaly === "PROJECT_CONFLICT" && workspaceId !== candidateWorkspaceId);
    if (isRunningContainer(container) && shouldQuarantine) {
      const firstSeen = suspiciousContainerSince.get(container.Id) ?? now;
      suspiciousContainerSince.set(container.Id, firstSeen);
      if (now - firstSeen >= ORPHAN_CONTAINER_GRACE_MS) {
        await stopOwnedContainer(container.Id, workspaceId ?? undefined).catch((error) => {
          console.error(`Unable to stop quarantined container ${container.Id}:`, error);
        });
      }
    } else {
      suspiciousContainerSince.delete(container.Id);
    }
  }

  const seenIds = new Set(containers.map((container) => container.Id));
  for (const id of suspiciousContainerSince.keys()) if (!seenIds.has(id)) suspiciousContainerSince.delete(id);

  for (const workspace of workspaces) {
    const container = workspace.containerId ? containers.find((candidate) => candidate.Id === workspace.containerId) : undefined;
    const healthy = container && isRunningContainer(container)
      && container.Labels["platform.workspace_id"] === workspace.id
      && container.Labels["platform.project_id"] === workspace.projectId
      && !conflictProjects.has(workspace.projectId);
    if (!healthy) continue;
    if (workspace.status === "ERROR" && (
      hasWorkspaceError(workspace.error, workspaceErrorCode.conflict)
      || hasWorkspaceError(workspace.error, workspaceErrorCode.ownership)
      || hasWorkspaceError(workspace.error, workspaceErrorCode.missing)
    )) {
      await db.workspace.update({ where: { id: workspace.id }, data: { status: "RUNNING", error: null } });
    } else if (workspace.status === "RUNNING") {
      await db.workspace.update({ where: { id: workspace.id }, data: { updatedAt: new Date() } });
    }
  }

  await writeContainerInventory({
    updatedAt: new Date().toISOString(),
    containers: inventory,
    conflictProjectIds,
    orphanCount: inventory.filter((entry) => entry.anomaly === "ORPHAN").length,
  });
  return { containers, conflictProjects };
}

async function stopWorkspace(db: PrismaClient, workspace: Workspace) {
  await db.workspace.updateMany({ where: { id: workspace.id, status: { not: "STOPPED" } }, data: { status: "STOPPING" } });
  await closeWorkspaceTerminals(workspace.id, "Workspace is stopping.");
  const resources = await db.resource.findMany({ where: { workspaceId: workspace.id, type: "CONTAINER" } });
  if (workspace.containerId) await stopOwnedContainer(workspace.containerId, workspace.id);
  for (const resource of resources) {
    if (resource.dockerId !== workspace.containerId) {
      await stopOwnedContainer(resource.dockerId, workspace.id, resource.composeProject);
    }
  }
  await db.$transaction([
    db.port.deleteMany({ where: { workspaceId: workspace.id } }),
    db.codexSession.updateMany({
      where: { workspaceId: workspace.id, status: { in: ["STARTING", "RUNNING"] } },
      data: { status: "INTERRUPTED", error: "Workspace stopped.", endedAt: new Date() },
    }),
    db.terminalRuntime.updateMany({
      where: { workspaceId: workspace.id, status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
      data: { status: "INTERRUPTED", activeKey: null, error: "Workspace stopped.", endedAt: new Date() },
    }),
    db.workspace.update({
      where: { id: workspace.id },
      data: {
        status: "STOPPED",
        activeAt: null,
        expiresAt: null,
        error: null,
        containerState: "exited",
        containerObservedAt: new Date(),
        containerStoppedAt: new Date(),
        containerStopReason: "REQUESTED",
      },
    }),
    db.lease.updateMany({
      where: { projectId: workspace.projectId, workspaceId: workspace.id, sub: workspace.sub },
      data: { state: "CLAIMED" },
    }),
  ]);
  publishToUser(workspace.sub, "workspace.status.changed", {
    status: "STOPPED",
    desiredState: "STOPPED",
    containerState: "exited",
    stopReason: "REQUESTED",
  }, { projectId: workspace.projectId, workspaceId: workspace.id });
}

async function deleteWorkspaceResources(db: PrismaClient, workspace: Workspace) {
  await closeWorkspaceTerminals(workspace.id, "Workspace is being deleted.");
  const resources = await db.resource.findMany({ where: { workspaceId: workspace.id } });
  const removalOrder = { CONTAINER: 0, NETWORK: 1, VOLUME: 2 } as const;
  for (const resource of [...resources].sort((left, right) => removalOrder[left.type] - removalOrder[right.type])) {
    try {
      if (resource.type === "CONTAINER") {
        await stopOwnedContainer(resource.dockerId, workspace.id, resource.composeProject);
        await docker.getContainer(resource.dockerId).remove();
      } else if (resource.type === "VOLUME") {
        await docker.getVolume(resource.dockerId).remove();
      } else if (resource.type === "NETWORK") {
        await docker.getNetwork(resource.dockerId).remove();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such|not found/i.test(message)) throw error;
    }
  }
  await db.$transaction([
    db.port.deleteMany({ where: { workspaceId: workspace.id } }),
    db.resource.deleteMany({ where: { workspaceId: workspace.id } }),
    db.workspace.update({ where: { id: workspace.id }, data: { status: "DELETED", containerId: null, activeAt: null, expiresAt: null, error: null } }),
    db.lease.deleteMany({ where: { projectId: workspace.projectId, workspaceId: workspace.id, sub: workspace.sub } }),
  ]);
}

async function reconcileDesiredStates(db: PrismaClient) {
  const stopping = await db.workspace.findMany({ where: { desiredState: "STOPPED", status: { notIn: ["STOPPED", "DELETED"] } } });
  for (const workspace of stopping) {
    try { await stopWorkspace(db, workspace); } catch (error) {
      await db.workspace.update({ where: { id: workspace.id }, data: { status: "ERROR", error: error instanceof Error ? error.message : "Workspace stop failed." } });
    }
  }
  const deleting = await db.workspace.findMany({ where: { desiredState: "DELETED", status: { not: "DELETED" } } });
  for (const workspace of deleting) {
    try { await deleteWorkspaceResources(db, workspace); } catch (error) {
      await db.workspace.update({ where: { id: workspace.id }, data: { status: "ERROR", error: error instanceof Error ? error.message : "Workspace deletion failed." } });
    }
  }
}

async function assertWorkspaceStartAllowed(db: PrismaClient, workspace: Workspace) {
  const [lease, conflictingWorkspace, containers] = await Promise.all([
    db.lease.findUnique({ where: { projectId: workspace.projectId } }),
    db.workspace.findFirst({
      where: { projectId: workspace.projectId, id: { not: workspace.id }, status: { in: [...ACTIVE_WORKSPACE_STATUSES] } },
      select: { id: true },
    }),
    listManagedContainers(),
  ]);
  if (!lease || lease.workspaceId !== workspace.id || lease.sub !== workspace.sub || lease.state !== "DEVELOPING") {
    throw new Error("LEASE_CONFLICT: Workspace lease is no longer valid.");
  }
  if (conflictingWorkspace) throw new Error("WORKSPACE_CONFLICT: Another active Workspace exists for this project.");
  const duplicate = containers.find((container) => isRunningContainer(container)
    && container.Labels["platform.project_id"] === workspace.projectId
    && container.Labels["platform.workspace_id"] !== workspace.id);
  if (duplicate) throw new Error(`${workspaceErrorCode.conflict}: Another active primary container exists for this project.`);
  const ownershipConflict = containers.find((container) => isRunningContainer(container)
    && container.Labels["platform.workspace_id"] === workspace.id
    && container.Labels["platform.project_id"] !== workspace.projectId);
  if (ownershipConflict) throw new Error(`${workspaceErrorCode.ownership}: Container labels do not match the Workspace project.`);
}

function parseJson<T>(stdout: string): T {
  const candidate = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!candidate) throw new Error("Dev Container CLI returned no result.");
  return JSON.parse(candidate) as T;
}

async function versionIsCurrent(db: PrismaClient, workspace: Workspace) {
  const current = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: { version: true, desiredState: true },
  });
  return current?.version === workspace.version && current.desiredState === "RUNNING";
}

async function inspectContainer(containerId: string) {
  const { stdout } = await run("docker", ["inspect", containerId]);
  const records = JSON.parse(stdout) as Array<{
    Name?: string;
    Config?: { Labels?: Record<string, string> };
    State?: { Running?: boolean };
    Mounts?: Array<{ Type?: string; Name?: string; Destination?: string }>;
    NetworkSettings?: { Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
  }>;
  const record = records[0];
  if (!record?.State?.Running) throw new Error("Dev Container was created but is not running.");
  return record;
}

async function syncPorts(db: PrismaClient, workspaceId: string, containerId: string, inspected?: Awaited<ReturnType<typeof inspectContainer>>) {
  const container = inspected ?? await inspectContainer(containerId);
  const bindings = container.NetworkSettings?.Ports ?? {};
  const seenIds: string[] = [];
  const publicHost = "127.0.0.1";
  const minPort = 1024;
  const maxPort = 65535;

  for (const [key, published] of Object.entries(bindings)) {
    const [containerPortText, proto = "tcp"] = key.split("/");
    const containerPort = Number(containerPortText);
    if (!published || proto !== "tcp" || !Number.isInteger(containerPort)) continue;
    for (const binding of published) {
      const hostPort = Number(binding.HostPort);
      if (!Number.isInteger(hostPort) || hostPort < minPort || hostPort > maxPort) continue;
      let available = false;
      try {
        await fetch(`http://127.0.0.1:${hostPort}/`, { signal: AbortSignal.timeout(2_000) });
        available = true;
      } catch {
        // A published port can become HTTP-ready after the container itself starts.
      }
      const port = await db.port.upsert({
        where: { workspaceId_containerId_containerPort_hostPort: { workspaceId, containerId, containerPort, hostPort } },
        create: {
          workspaceId, containerId, containerPort, hostIp: binding.HostIp, hostPort, proto,
          url: available ? `http://${publicHost}:${hostPort}/` : null,
          status: available ? "AVAILABLE" : "WAITING", checkedAt: new Date(),
        },
        update: {
          hostIp: binding.HostIp,
          url: available ? `http://${publicHost}:${hostPort}/` : null,
          status: available ? "AVAILABLE" : "WAITING", checkedAt: new Date(),
        },
      });
      seenIds.push(port.id);
    }
  }
  await db.port.deleteMany({ where: { workspaceId, ...(seenIds.length ? { id: { notIn: seenIds } } : {}) } });
}

async function syncWorkspaceResources(
  db: PrismaClient,
  workspaceId: string,
  containerId: string,
  inspected: Awaited<ReturnType<typeof inspectContainer>>,
) {
  const labels = inspected.Config?.Labels ?? {};
  const composeProject = labels["com.docker.compose.project"] ?? null;
  await db.resource.upsert({
    where: { workspaceId_type_dockerId: { workspaceId, type: "CONTAINER", dockerId: containerId } },
    create: { workspaceId, type: "CONTAINER", dockerId: containerId, name: inspected.Name?.replace(/^\//, ""), labels, composeProject },
    update: { name: inspected.Name?.replace(/^\//, ""), labels, composeProject },
  });
  if (!composeProject) return;

  const [containers, volumes, networks] = await Promise.all([
    docker.listContainers({ all: true, filters: { label: [`com.docker.compose.project=${composeProject}`] } }),
    docker.listVolumes({ filters: { label: [`com.docker.compose.project=${composeProject}`] } }),
    docker.listNetworks({ filters: { label: [`com.docker.compose.project=${composeProject}`] } }),
  ]);
  for (const container of containers) {
    await db.resource.upsert({
      where: { workspaceId_type_dockerId: { workspaceId, type: "CONTAINER", dockerId: container.Id } },
      create: { workspaceId, type: "CONTAINER", dockerId: container.Id, name: container.Names[0]?.replace(/^\//, ""), labels: container.Labels, composeProject },
      update: { name: container.Names[0]?.replace(/^\//, ""), labels: container.Labels, composeProject },
    });
  }
  for (const volume of volumes.Volumes ?? []) {
    await db.resource.upsert({
      where: { workspaceId_type_dockerId: { workspaceId, type: "VOLUME", dockerId: volume.Name } },
      create: { workspaceId, type: "VOLUME", dockerId: volume.Name, name: volume.Name, labels: volume.Labels, composeProject },
      update: { name: volume.Name, labels: volume.Labels, composeProject },
    });
  }
  for (const network of networks) {
    await db.resource.upsert({
      where: { workspaceId_type_dockerId: { workspaceId, type: "NETWORK", dockerId: network.Id } },
      create: { workspaceId, type: "NETWORK", dockerId: network.Id, name: network.Name, labels: network.Labels, composeProject },
      update: { name: network.Name, labels: network.Labels, composeProject },
    });
  }
}

async function validateSharedCodexStorage(containerId: string, remoteUser: string) {
  const container = docker.getContainer(containerId);
  const inspected = await container.inspect();
  const destinations = new Set(inspected.Mounts.map((mount) => mount.Destination));
  if (!destinations.has(CODEX_HOME_CONTAINER_PATH)) {
    throw new Error(`Shared Codex home is not mounted at ${CODEX_HOME_CONTAINER_PATH}.`);
  }
  if (!destinations.has(CODEX_SQLITE_HOME_CONTAINER_PATH)) {
    throw new Error(`Shared Codex SQLite home is not mounted at ${CODEX_SQLITE_HOME_CONTAINER_PATH}.`);
  }
  const setup = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    User: remoteUser,
    Env: [
      `CODEX_HOME_TARGET=${CODEX_HOME_CONTAINER_PATH}`,
      `CODEX_SQLITE_HOME_TARGET=${CODEX_SQLITE_HOME_CONTAINER_PATH}`,
    ],
    Cmd: [
      "sh",
      "-lc",
      "set -eu; test -d \"$CODEX_HOME_TARGET\" && test -r \"$CODEX_HOME_TARGET\" && test -w \"$CODEX_HOME_TARGET\"; test -d \"$CODEX_SQLITE_HOME_TARGET\" && test -r \"$CODEX_SQLITE_HOME_TARGET\" && test -w \"$CODEX_SQLITE_HOME_TARGET\"",
    ],
  });
  const stream = await setup.start({ hijack: true, stdin: false, Tty: false });
  stream.resume();
  await finished(stream);
  const result = await setup.inspect();
  if (result.ExitCode !== 0) throw new Error("Shared Codex session storage is not accessible to the Dev Container user.");
}

function appendStartupOutput(workspaceId: string, output: ProcessOutputLine) {
  const message = normalizeStartupLogMessage(output.message);
  if (message === null) return;
  return appendWorkspaceLog(workspaceId, {
    channel: "startup",
    stream: output.stream,
    level: "info",
    message,
  });
}

function appendStartupSystem(workspaceId: string, message: string, level: "info" | "error" = "info") {
  return appendWorkspaceLog(workspaceId, { channel: "startup", stream: "system", level, message });
}

async function recoverStuckWorkspaces(db: PrismaClient) {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const stuck = await db.workspace.findMany({
    where: { desiredState: "RUNNING", status: { in: ["CREATING", "STARTING"] }, updatedAt: { lt: cutoff } },
  });
  for (const workspace of stuck) {
    const reason = "Workspace startup was interrupted; Runner will retry devcontainer up.";
    await db.workspace.update({ where: { id: workspace.id }, data: { status: "ERROR", containerId: null, error: reason } });
    await appendStartupSystem(workspace.id, reason, "error");
  }
}

async function reconcileRunningContainers(db: PrismaClient) {
  const workspaces = await db.workspace.findMany({
    where: { status: "RUNNING", desiredState: "RUNNING", containerId: { not: null } },
    select: { id: true, projectId: true, sub: true, containerId: true },
  });

  for (const workspace of workspaces) {
    let containerMissing = false;
    try {
      const { stdout } = await run("docker", ["inspect", "--format", "{{json .State.Running}}", workspace.containerId!]);
      if (stdout.trim() === "true") continue;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such (?:object|container)/i.test(message)) {
        console.error(`Unable to inspect Workspace ${workspace.id}: ${message}`);
        continue;
      }
      containerMissing = true;
    }

    await applyUnexpectedContainerStopped(db, {
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      sub: workspace.sub,
      containerId: workspace.containerId!,
      reason: "UNKNOWN",
      containerMissing,
    });
  }
}

async function reconcileIdleWorkspaces(db: PrismaClient) {
  await db.workspace.updateMany({
    where: { status: "RUNNING", desiredState: "RUNNING", expiresAt: null },
    data: { expiresAt: workspaceIdleDeadline() },
  });

  const expired = await db.workspace.findMany({
    where: { status: "RUNNING", desiredState: "RUNNING", expiresAt: { lte: new Date() } },
    select: { id: true, expiresAt: true },
  });
  for (const workspace of expired) {
    if (!workspace.expiresAt) continue;
    if (await hasActiveWorkspaceTerminalRuntime(db, workspace.id)) continue;
    const claimed = await db.workspace.updateMany({
      where: {
        id: workspace.id,
        status: "RUNNING",
        desiredState: "RUNNING",
        expiresAt: workspace.expiresAt,
      },
      data: { status: "STOPPING", desiredState: "STOPPED", version: { increment: 1 } },
    });
    if (claimed.count === 1) {
      await appendStartupSystem(workspace.id, "Workspace stopped after 10 minutes without active use.");
    }
  }
}

async function startWorkspace(db: PrismaClient, workspace: Workspace) {
  const claimed = await db.workspace.updateMany({
    where: { id: workspace.id, version: workspace.version, status: { in: ["PENDING", "ERROR"] }, desiredState: "RUNNING" },
    data: { status: "CREATING", error: null },
  });
  if (claimed.count !== 1) return;

  try {
    await assertWorkspaceStartAllowed(db, workspace);
    await appendStartupSystem(workspace.id, "Calculating Dev Container configuration hash.");
    const devcontainerHash = await hashDevcontainerDirectory(workspace.path);
    const project = await db.project.findUnique({ where: { id: workspace.projectId }, select: { devcontainerHash: true } });
    if (!project) throw new Error("Project no longer exists.");
    const configurationChanged = project.devcontainerHash !== devcontainerHash;
    await appendStartupSystem(workspace.id, configurationChanged
      ? "Dev Container configuration hash changed; the existing container will be replaced by devcontainer up."
      : "Dev Container configuration hash is unchanged.");

    await appendStartupSystem(workspace.id, "Validating Dev Container configuration.");
    const configResult = await runDevcontainerStreaming([
      "read-configuration",
      "--include-merged-configuration",
      "--workspace-folder",
      workspace.path,
    ], workspace.path, 60_000, (output) => appendStartupOutput(workspace.id, output));
    const config = parseJson<DevcontainerConfig>(configResult.stdout);
    const errors = validateContainerConfig(config, workspace.path);
    if (errors.length) throw new Error(errors.join("; "));
    const remoteUser = config.mergedConfiguration?.remoteUser;
    if (!remoteUser) throw new Error("Dev Container remoteUser is required for persistent Codex sessions.");
    const services = await registerProcessServices(workspace.id, workspace.path);
    await appendStartupSystem(
      workspace.id,
      services.length > 0 ? `Registered ${services.length} service log source${services.length === 1 ? "" : "s"}.` : "No service log sources were declared.",
    );

    if (!(await versionIsCurrent(db, workspace))) return;
    await assertWorkspaceStartAllowed(db, workspace);
    await db.workspace.update({ where: { id: workspace.id }, data: { status: "STARTING" } });
    await appendStartupSystem(workspace.id, configurationChanged
      ? "Running devcontainer up with forced container recreation."
      : "Running devcontainer up; the Dev Container configuration is unchanged.");

    const upOutput = await runDevcontainerStreaming([
        "up",
        "--workspace-folder",
        workspace.path,
        ...(configurationChanged ? ["--remove-existing-container"] : []),
        "--id-label",
        "platform.managed=true",
        "--id-label",
        `platform.workspace_id=${workspace.id}`,
        "--id-label",
        `platform.project_id=${workspace.projectId}`,
      ], workspace.path, 15 * 60_000, (output) => appendStartupOutput(workspace.id, output));
    const result = parseJson<DevcontainerUpResult>(upOutput.stdout);
    if (result.outcome !== "success" || !result.containerId) {
      throw new Error(result.description || result.message || "Dev Container failed to start.");
    }

    const inspected = await inspectContainer(result.containerId);
    await appendStartupSystem(workspace.id, `Container ${result.containerId.slice(0, 12)} is running.`);
    await appendStartupSystem(workspace.id, "Validating shared Codex session storage.");
    await validateSharedCodexStorage(result.containerId, remoteUser);
    await appendStartupSystem(workspace.id, "Shared Codex session storage is ready.");
    await db.resource.upsert({
      where: { workspaceId_type_dockerId: { workspaceId: workspace.id, type: "CONTAINER", dockerId: result.containerId } },
      create: {
        workspaceId: workspace.id,
        type: "CONTAINER",
        dockerId: result.containerId,
        name: inspected.Name?.replace(/^\//, ""),
        labels: inspected.Config?.Labels,
      },
      update: { name: inspected.Name?.replace(/^\//, ""), labels: inspected.Config?.Labels },
    });
    await syncWorkspaceResources(db, workspace.id, result.containerId, inspected);

    if (!(await versionIsCurrent(db, workspace))) return;
    await db.$transaction([
      db.project.update({ where: { id: workspace.projectId }, data: { devcontainerHash } }),
      db.workspace.update({
        where: { id: workspace.id },
        data: {
          status: "RUNNING",
          containerId: result.containerId,
          containerState: "running",
          containerObservedAt: new Date(),
          containerStartedAt: new Date(),
          containerStoppedAt: null,
          containerExitCode: null,
          containerStopReason: null,
          containerOomDetected: false,
          devcontainerHash,
          activeAt: new Date(),
          expiresAt: workspaceIdleDeadline(),
          error: null,
        },
      }),
    ]);
    await syncPorts(db, workspace.id, result.containerId, inspected);
    await appendStartupSystem(workspace.id, "Workspace is ready; opening the development view.");
    publishToUser(workspace.sub, "workspace.status.changed", {
      status: "RUNNING",
      desiredState: "RUNNING",
      containerState: "running",
    }, { projectId: workspace.projectId, workspaceId: workspace.id });
  } catch (error) {
    await db.port.deleteMany({ where: { workspaceId: workspace.id } });
    await appendStartupSystem(workspace.id, error instanceof Error ? error.message : "Workspace startup failed.", "error");
    await db.workspace.update({
      where: { id: workspace.id },
      data: { status: "ERROR", error: error instanceof Error ? error.message : "Workspace startup failed." },
    });
    throw error;
  }
}

async function syncRunningWorkspaces(db: PrismaClient) {
  const workspaces = await db.workspace.findMany({
    where: { status: "RUNNING", desiredState: "RUNNING", containerId: { not: null } },
  });
  for (const workspace of workspaces) {
    if (workspace.containerId) {
      try {
        await syncPorts(db, workspace.id, workspace.containerId);
      } catch (error) {
        console.error(`Unable to sync Workspace ${workspace.id}:`, error instanceof Error ? error.message : error);
        continue;
      }
      try {
        const savedServices = await hasWorkspaceServiceCatalog(workspace.id)
          ? await readWorkspaceServices(workspace.id)
          : [];
        const configuredServices = await loadProcessServices(workspace.path);
        const services = JSON.stringify(savedServices) === JSON.stringify(configuredServices)
          ? savedServices
          : await registerProcessServices(workspace.id, workspace.path);
        await syncProcessServiceLogs(workspace.id, workspace.containerId, services);
      } catch (error) {
        console.error(`Unable to sync service logs for Workspace ${workspace.id}:`, error instanceof Error ? error.message : error);
      }
    }
  }
}

export async function reconcileOnce(db: PrismaClient) {
  await reconcileDesiredStates(db);
  await recoverStuckWorkspaces(db);
  await reconcileContainerInventory(db);
  await reconcileRunningContainers(db);
  const workspaces = await db.workspace.findMany({
    where: { desiredState: "RUNNING", status: { in: ["PENDING", "ERROR"] } },
    orderBy: { createdAt: "asc" },
  });
  for (const workspace of workspaces) {
    try {
      await startWorkspace(db, workspace);
    } catch (error) {
      console.error(`Workspace ${workspace.id}:`, error instanceof Error ? error.message : error);
    }
  }
  await reconcileServiceOperations(db);
  await syncRunningWorkspaces(db);
  await reconcileIdleWorkspaces(db);
  await reconcileDesiredStates(db);
}
