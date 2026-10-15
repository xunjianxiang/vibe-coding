import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { appendWorkspaceLog, readWorkspaceServices, type WorkspaceService } from "@/runner/logs";
import { run } from "@/runner/process";
import { resetProcessServiceCursors, syncProcessServiceLogs } from "@/runner/services";

type ContainerInspect = {
  Config?: { Labels?: Record<string, string> };
  Mounts?: Array<{ Type?: string; Source?: string; Destination?: string }>;
  State?: { Running?: boolean };
};

function operationMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 4_096 ? `${message.slice(0, 4_093)}...` : message;
}

function runtimeLocation(container: ContainerInspect, workspacePath: string) {
  if (!container.State?.Running) throw new Error("Workspace container is not running.");
  const mount = container.Mounts?.find((candidate) => candidate.Type === "bind"
    && candidate.Source && path.resolve(candidate.Source).toLowerCase() === path.resolve(workspacePath).toLowerCase());
  if (!mount?.Destination) throw new Error("Workspace bind mount was not found in the container.");

  let remoteUser: string | undefined;
  const metadata = container.Config?.Labels?.["devcontainer.metadata"];
  if (metadata) {
    const entries = JSON.parse(metadata) as Array<{ remoteUser?: string }>;
    remoteUser = entries.findLast((entry) => entry.remoteUser)?.remoteUser;
  }
  if (!remoteUser) throw new Error("Dev Container remoteUser is required for service operations.");
  return { remoteUser, workspaceFolder: mount.Destination };
}

async function restartService(
  workspaceId: string,
  projectId: string,
  workspacePath: string,
  containerId: string,
  service: WorkspaceService,
) {
  if (!service.command) throw new Error(`Service ${service.id} does not declare a start command.`);
  await syncProcessServiceLogs(workspaceId, containerId, [service]);
  await appendWorkspaceLog(workspaceId, {
    channel: "service",
    serviceId: service.id,
    stream: "system",
    level: "info",
    message: `正在重启 ${service.name}...`,
  });

  const inspected = JSON.parse((await run("docker", ["inspect", containerId])).stdout) as ContainerInspect[];
  const labels = inspected[0]?.Config?.Labels ?? {};
  if (labels["platform.managed"] !== "true" || labels["platform.workspace_id"] !== workspaceId || labels["platform.project_id"] !== projectId) {
    throw new Error("Workspace container ownership could not be verified.");
  }
  const location = runtimeLocation(inspected[0] ?? {}, workspacePath);
  try {
    await run("docker", [
      "exec",
      "--user", location.remoteUser,
      "--workdir", location.workspaceFolder,
      containerId,
      "bash", ".devcontainer/scripts/service.sh", "start", service.id,
    ], undefined, 60_000);
  } finally {
    await resetProcessServiceCursors(workspaceId, service.id);
  }

  await appendWorkspaceLog(workspaceId, {
    channel: "service",
    serviceId: service.id,
    stream: "system",
    level: "info",
    message: `${service.name} 已重启。`,
  });
}

async function recoverStuckOperations(db: PrismaClient) {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  await db.serviceOperation.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: {
      status: "FAILED",
      activeKey: null,
      error: "Runner was interrupted while executing the service operation.",
      finishedAt: new Date(),
    },
  });
}

export async function reconcileServiceOperations(db: PrismaClient) {
  await recoverStuckOperations(db);
  const pending = await db.serviceOperation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const operation of pending) {
    const claimed = await db.serviceOperation.updateMany({
      where: { id: operation.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), error: null },
    });
    if (claimed.count !== 1) continue;

    try {
      const workspace = await db.workspace.findFirst({
        where: {
          id: operation.workspaceId,
          sub: operation.requestedBy,
          status: "RUNNING",
          desiredState: "RUNNING",
          containerId: { not: null },
          project: {
            lease: {
              is: {
                sub: operation.requestedBy,
                workspaceId: operation.workspaceId,
                state: "DEVELOPING",
              },
            },
          },
        },
      });
      if (!workspace?.containerId) throw new Error("Workspace is not running.");
      const service = (await readWorkspaceServices(workspace.id)).find((candidate) => candidate.id === operation.serviceId);
      if (!service) throw new Error(`Service ${operation.serviceId} is not registered.`);
      if (operation.action === "RESTART") {
        await restartService(workspace.id, workspace.projectId, workspace.path, workspace.containerId, service);
      }
      await db.serviceOperation.update({
        where: { id: operation.id },
        data: { status: "SUCCEEDED", activeKey: null, finishedAt: new Date() },
      });
    } catch (error) {
      const message = operationMessage(error);
      await appendWorkspaceLog(operation.workspaceId, {
        channel: "service",
        serviceId: operation.serviceId,
        stream: "system",
        level: "error",
        message: `服务重启失败：${message}`,
      });
      await db.serviceOperation.update({
        where: { id: operation.id },
        data: { status: "FAILED", activeKey: null, error: message, finishedAt: new Date() },
      });
    }
  }
}
