import type { PrismaClient } from "@prisma/client";

export type ContainerInventoryEntry = {
  id: string;
  name: string | null;
  workspaceId: string | null;
  projectId: string | null;
  expectedProjectId: string | null;
  expectedRunning: boolean;
  state: string;
  running: boolean;
  exitCode: number | null;
  finishedAt: string | null;
  oomKilled: boolean;
  dead: boolean;
  error: string | null;
  anomaly: "ORPHAN" | "PROJECT_CONFLICT" | "OWNERSHIP_CONFLICT" | null;
};

export type ContainerInventorySnapshot = {
  updatedAt: string;
  containers: ContainerInventoryEntry[];
  conflictProjectIds: string[];
  orphanCount: number;
};

type Db = Pick<PrismaClient, "containerObservation" | "$transaction">;

export async function readContainerInventory(db: Db): Promise<ContainerInventorySnapshot> {
  const observations = await db.containerObservation.findMany({ orderBy: { containerId: "asc" } });
  const containers = observations.map((item) => ({
    id: item.containerId,
    name: item.name,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    expectedProjectId: item.expectedProjectId,
    expectedRunning: item.expectedRunning,
    state: item.state,
    running: item.running,
    exitCode: item.exitCode,
    finishedAt: item.finishedAt?.toISOString() ?? null,
    oomKilled: item.oomKilled,
    dead: item.dead,
    error: item.error,
    anomaly: item.anomaly as ContainerInventoryEntry["anomaly"],
  }));
  return {
    updatedAt: observations.reduce((latest, item) => item.observedAt > latest ? item.observedAt : latest, new Date(0)).toISOString(),
    containers,
    conflictProjectIds: [...new Set(containers.filter((item) => item.anomaly === "PROJECT_CONFLICT" && item.projectId).map((item) => item.projectId as string))],
    orphanCount: containers.filter((item) => item.anomaly === "ORPHAN").length,
  };
}

export function projectHasContainerConflict(snapshot: ContainerInventorySnapshot, projectId: string) {
  return snapshot.conflictProjectIds.includes(projectId)
    || snapshot.containers.some((container) => (container.projectId === projectId || container.expectedProjectId === projectId)
      && container.running && container.anomaly !== null);
}

export function isSafeOrphanCleanup(
  containerId: string,
  labels: Record<string, string>,
  workspace: { containerId: string | null } | null,
) {
  if (labels["platform.managed"] !== "true") return false;
  return workspace === null || (workspace.containerId !== null && workspace.containerId !== containerId);
}

export async function writeContainerInventory(db: Db, snapshot: ContainerInventorySnapshot) {
  const ids = snapshot.containers.map((entry) => entry.id);
  await db.$transaction(async (tx) => {
    await tx.containerObservation.deleteMany(ids.length ? { where: { containerId: { notIn: ids } } } : undefined);
    for (const entry of snapshot.containers) {
      const data = {
        name: entry.name,
        workspaceId: entry.workspaceId,
        projectId: entry.projectId,
        expectedProjectId: entry.expectedProjectId,
        expectedRunning: entry.expectedRunning,
        state: entry.state,
        running: entry.running,
        exitCode: entry.exitCode,
        finishedAt: entry.finishedAt ? new Date(entry.finishedAt) : null,
        oomKilled: entry.oomKilled,
        dead: entry.dead,
        error: entry.error,
        anomaly: entry.anomaly,
        observedAt: new Date(snapshot.updatedAt),
      };
      await tx.containerObservation.upsert({
        where: { containerId: entry.id },
        create: { containerId: entry.id, ...data },
        update: data,
      });
    }
  });
}
