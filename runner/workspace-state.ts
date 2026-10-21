import type { PrismaClient, WorkspaceContainerStopReason } from "@prisma/client";
import { appendWorkspaceLog } from "@/runner/logs";
import { publishToUser } from "@/runner/realtime-hub";
import { closeWorkspaceTerminals } from "@/runner/terminal-gateway";
import { disconnectManagedContainerFromPreviewNetwork } from "@/runner/preview-network";

export type ContainerStoppedInput = {
  workspaceId: string;
  projectId: string;
  sub: string;
  containerId: string;
  state?: string;
  exitCode?: number | null;
  reason: WorkspaceContainerStopReason;
  containerMissing?: boolean;
};

export async function applyUnexpectedContainerStopped(db: PrismaClient, input: ContainerStoppedInput) {
  const stoppedAt = new Date();
  const changed = await db.$transaction(async (tx) => {
    const stopped = await tx.workspace.updateMany({
      where: {
        id: input.workspaceId,
        projectId: input.projectId,
        sub: input.sub,
        status: "RUNNING",
        containerId: input.containerId,
      },
      data: {
        status: "STOPPED",
        activeAt: null,
        expiresAt: null,
        error: null,
        version: { increment: 1 },
        containerState: input.state ?? (input.containerMissing ? "missing" : "exited"),
        containerObservedAt: stoppedAt,
        containerStoppedAt: stoppedAt,
        containerExitCode: input.exitCode ?? null,
        containerStopReason: input.reason,
        ...(input.containerMissing ? { containerId: null } : {}),
      },
    });
    if (stopped.count !== 1) return false;
    await tx.port.deleteMany({ where: { workspaceId: input.workspaceId } });
    await tx.codexSession.updateMany({
      where: { workspaceId: input.workspaceId, status: { in: ["STARTING", "RUNNING", "ERROR"] } },
      data: { status: "INTERRUPTED", error: "Workspace container stopped.", endedAt: stoppedAt },
    });
    await tx.lease.updateMany({
      where: { projectId: input.projectId, workspaceId: input.workspaceId, sub: input.sub },
      data: { state: "CLAIMED" },
    });
    return true;
  });

  if (!changed) return false;
  if (!input.containerMissing) await disconnectManagedContainerFromPreviewNetwork(input.containerId).catch(() => undefined);
  await closeWorkspaceTerminals(input.workspaceId, "Workspace container stopped.");
  await db.terminalRuntime.updateMany({
    where: { workspaceId: input.workspaceId, status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
    data: { status: "INTERRUPTED", activeKey: null, error: "Workspace container stopped.", endedAt: stoppedAt },
  });
  await appendWorkspaceLog(input.workspaceId, {
    channel: "startup",
    stream: "system",
    level: input.reason === "NORMAL_EXIT" ? "info" : "error",
    message: "Workspace container stopped; restart it to continue development.",
  });
  publishToUser(input.sub, "workspace.status.changed", {
    status: "STOPPED",
    containerState: input.state ?? (input.containerMissing ? "missing" : "exited"),
    exitCode: input.exitCode ?? null,
    stopReason: input.reason,
  }, { projectId: input.projectId, workspaceId: input.workspaceId });
  return true;
}
