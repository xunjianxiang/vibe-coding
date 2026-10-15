import type { PrismaClient } from "@prisma/client";
import type Docker from "dockerode";
import { isSafeOrphanCleanup } from "@/lib/container-inventory";

export type ContainerCleanupResult = "REMOVED" | "NOT_FOUND" | "NOT_ORPHANED";

function isDockerNotFound(error: unknown) {
  return error !== null
    && typeof error === "object"
    && "statusCode" in error
    && error.statusCode === 404;
}

export async function removeOrphanContainer(
  db: PrismaClient,
  docker: Docker,
  containerId: string,
): Promise<ContainerCleanupResult> {
  const container = docker.getContainer(containerId);
  let inspected: Docker.ContainerInspectInfo;
  try {
    inspected = await container.inspect();
  } catch (error) {
    if (isDockerNotFound(error)) return "NOT_FOUND";
    throw error;
  }

  const labels = inspected.Config.Labels ?? {};
  const workspaceId = labels["platform.workspace_id"] || null;
  const workspace = workspaceId
    ? await db.workspace.findUnique({ where: { id: workspaceId }, select: { containerId: true } })
    : null;
  if (!isSafeOrphanCleanup(containerId, labels, workspace)) return "NOT_ORPHANED";

  if (inspected.State.Running) await container.stop({ t: 10 });
  try {
    await container.remove();
  } catch (error) {
    if (!isDockerNotFound(error)) throw error;
  }
  return "REMOVED";
}
