import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

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

const inventoryPath = path.join(
  path.resolve(/* turbopackIgnore: true */ process.env.APP_ROOT || process.cwd()),
  ".runner",
  "container-inventory.json",
);

export async function readContainerInventory(): Promise<ContainerInventorySnapshot> {
  try {
    return JSON.parse(await readFile(inventoryPath, "utf8")) as ContainerInventorySnapshot;
  } catch {
    return { updatedAt: new Date(0).toISOString(), containers: [], conflictProjectIds: [], orphanCount: 0 };
  }
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

function comparableInventory(snapshot: ContainerInventorySnapshot) {
  return JSON.stringify({
    containers: [...snapshot.containers].sort((left, right) => left.id.localeCompare(right.id)),
    conflictProjectIds: [...snapshot.conflictProjectIds].sort(),
    orphanCount: snapshot.orphanCount,
  });
}

export async function writeContainerInventory(snapshot: ContainerInventorySnapshot) {
  const current = await readContainerInventory();
  if (comparableInventory(current) === comparableInventory(snapshot)) return;
  const directory = path.dirname(inventoryPath);
  const temporary = `${inventoryPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, inventoryPath);
        break;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        if (!(["EACCES", "EBUSY", "EPERM"].includes(String(code))) || attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
