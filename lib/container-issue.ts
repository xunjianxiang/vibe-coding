import type { ContainerInventoryEntry } from "@/lib/container-inventory";

export function isAbnormalContainerExit(container: ContainerInventoryEntry) {
  const failedProcess = container.exitCode !== null
    && container.exitCode !== 0
    && (container.expectedRunning || ![137, 143].includes(container.exitCode));

  return !container.running && (
    container.oomKilled
    || container.dead
    || failedProcess
    || container.error != null
  );
}

export function hasContainerIssue(container: ContainerInventoryEntry) {
  return container.anomaly !== null || isAbnormalContainerExit(container);
}
