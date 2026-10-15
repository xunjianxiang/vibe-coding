import type { PrismaClient, WorkspaceContainerStopReason } from "@prisma/client";
import Docker from "dockerode";
import { applyUnexpectedContainerStopped } from "@/runner/workspace-state";
import { publishToAll, publishToUser } from "@/runner/realtime-hub";

const RUNNER_ID = "local";
const HEALTH_INTERVAL_MS = 5_000;
const MAX_RECONNECT_MS = 30_000;

type DockerEvent = {
  status?: string;
  Action?: string;
  id?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
  time?: number;
  timeNano?: number;
};

const oomEvidence = new Set<string>();
const stopEvidence = new Set<string>();
const seenEvents = new Map<string, number>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Docker health check timed out.")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function updateHealth(db: PrismaClient, dockerStatus: "HEALTHY" | "UNREACHABLE", eventStreamConnected: boolean, error: string | null) {
  const current = await db.runnerHealth.findUnique({ where: { id: RUNNER_ID } });
  const changed = !current || current.dockerStatus !== dockerStatus || current.eventStreamConnected !== eventStreamConnected;
  const checkedAt = new Date();
  await db.runnerHealth.upsert({
    where: { id: RUNNER_ID },
    create: { id: RUNNER_ID, dockerStatus, eventStreamConnected, checkedAt, error },
    update: { dockerStatus, eventStreamConnected, checkedAt, error },
  });
  if (changed) publishToAll("runner.health.changed", { dockerStatus, eventStreamConnected, checkedAt: checkedAt.toISOString() });
}

async function markEventStreamDisconnected(db: PrismaClient, error: string) {
  const current = await db.runnerHealth.findUnique({ where: { id: RUNNER_ID }, select: { dockerStatus: true } });
  await updateHealth(db, current?.dockerStatus ?? "UNREACHABLE", false, error);
}

export function classifyContainerStop(exitCode: number | null, oom: boolean, requested: boolean): WorkspaceContainerStopReason {
  if (requested) return "REQUESTED";
  if (oom) return "OOM";
  if (exitCode === 0) return "NORMAL_EXIT";
  if (exitCode !== null) return "PROCESS_ERROR";
  return "UNKNOWN";
}

async function handleEvent(db: PrismaClient, docker: Docker, event: DockerEvent) {
  const action = event.Action ?? event.status;
  if (!action || !["start", "die", "oom", "stop"].includes(action)) return;
  const containerId = event.Actor?.ID ?? event.id;
  const attributes = event.Actor?.Attributes ?? {};
  const workspaceId = attributes["platform.workspace_id"];
  const projectId = attributes["platform.project_id"];
  if (!containerId || !workspaceId || !projectId || attributes["platform.managed"] !== "true") return;

  const eventKey = `${containerId}:${action}:${event.timeNano ?? event.time ?? 0}`;
  if (seenEvents.has(eventKey)) return;
  seenEvents.set(eventKey, Date.now());
  for (const [key, seenAt] of seenEvents) if (Date.now() - seenAt > 60_000) seenEvents.delete(key);

  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, projectId, containerId },
    select: { id: true, projectId: true, sub: true, containerId: true, status: true, desiredState: true },
  });
  if (!workspace?.containerId) return;

  if (action === "start") {
    oomEvidence.delete(containerId);
    stopEvidence.delete(containerId);
    const observedAt = new Date();
    await db.workspace.updateMany({
      where: { id: workspaceId, containerId },
      data: {
        containerState: "running",
        containerObservedAt: observedAt,
        containerStartedAt: observedAt,
        containerStoppedAt: null,
        containerExitCode: null,
        containerStopReason: null,
        containerOomDetected: false,
      },
    });
    publishToUser(workspace.sub, "container.status.changed", { state: "running", running: true }, { projectId, workspaceId });
    return;
  }

  if (action === "oom") {
    oomEvidence.add(containerId);
    const observedAt = new Date();
    await db.workspace.updateMany({
      where: { id: workspaceId, containerId },
      data: { containerOomDetected: true, containerObservedAt: observedAt },
    });
    publishToUser(workspace.sub, "container.status.changed", { state: "running", running: true, oomDetected: true }, { projectId, workspaceId });
    return;
  }

  if (action === "stop") {
    stopEvidence.add(containerId);
    return;
  }

  const inspected = await docker.getContainer(containerId).inspect().catch(() => null);
  const exitCode = typeof inspected?.State.ExitCode === "number" ? inspected.State.ExitCode : null;
  const oom = oomEvidence.has(containerId) || inspected?.State.OOMKilled === true;
  const requested = workspace.desiredState !== "RUNNING" || workspace.status === "STOPPING" || workspace.status === "DELETING" || stopEvidence.has(containerId);
  oomEvidence.delete(containerId);
  stopEvidence.delete(containerId);
  await applyUnexpectedContainerStopped(db, {
    workspaceId,
    projectId,
    sub: workspace.sub,
    containerId,
    state: inspected?.State.Status ?? "exited",
    exitCode,
    reason: classifyContainerStop(exitCode, oom, requested),
  });
}

async function monitorHealth(db: PrismaClient, docker: Docker, isStreamConnected: () => boolean) {
  while (true) {
    try {
      await withTimeout(docker.ping(), 3_000);
      await updateHealth(db, "HEALTHY", isStreamConnected(), null);
    } catch (error) {
      await updateHealth(db, "UNREACHABLE", false, error instanceof Error ? error.message : "Docker Engine is unreachable.");
    }
    await delay(HEALTH_INTERVAL_MS);
  }
}

async function monitorEvents(db: PrismaClient, docker: Docker, calibrate: () => Promise<void>, setConnected: (connected: boolean) => void) {
  let retryMs = 1_000;
  while (true) {
    try {
      const stream = await docker.getEvents({
        since: Math.floor(Date.now() / 1000) - 5,
        filters: { type: ["container"], event: ["start", "die", "oom", "stop"], label: ["platform.managed=true"] },
      });
      setConnected(true);
      retryMs = 1_000;
      await updateHealth(db, "HEALTHY", true, null);
      await calibrate();

      let buffer = "";
      let queue = Promise.resolve();
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            queue = queue.then(async () => handleEvent(db, docker, JSON.parse(line) as DockerEvent));
            queue.catch((error) => console.error("Docker event handling failed:", error));
          }
        });
        stream.once("error", reject);
        stream.once("end", resolve);
        stream.once("close", resolve);
      });
      await queue;
      throw new Error("Docker event stream closed.");
    } catch (error) {
      setConnected(false);
      await markEventStreamDisconnected(db, error instanceof Error ? error.message : "Docker event stream disconnected.").catch(console.error);
      await delay(retryMs + Math.floor(Math.random() * Math.min(retryMs, 1_000)));
      retryMs = Math.min(retryMs * 2, MAX_RECONNECT_MS);
    }
  }
}

export async function startDockerMonitor(db: PrismaClient, calibrate: () => Promise<void>) {
  const docker = new Docker();
  let eventStreamConnected = false;
  await Promise.all([
    monitorHealth(db, docker, () => eventStreamConnected),
    monitorEvents(db, docker, calibrate, (connected) => { eventStreamConnected = connected; }),
  ]);
}
