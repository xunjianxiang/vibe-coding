export const TERMINAL_RUNTIME_IDLE_TIMEOUT_MS = 10 * 60_000;
export const ORPHAN_CONTAINER_GRACE_MS = 60_000;
export const WORKSPACE_ACTIVITY_INTERVAL_MS = 30_000;
export const WORKSPACE_RESUME_DRIFT_MS = 90_000;
export const WORKSPACE_IDLE_TIMEOUT_MS = 10 * 60_000;

export function codexStoragePaths(userHome: string) {
  const home = userHome.replace(/\/+$/, "");
  if (!home.startsWith("/") || home === "") {
    throw new Error("Dev Container user home must be an absolute path.");
  }
  return {
    codexHome: `${home}/.codex`,
    codexSqliteHome: `${home}/.codex-sqlite`,
  };
}

export function workspaceIdleDeadline(now = Date.now()) {
  return new Date(now + WORKSPACE_IDLE_TIMEOUT_MS);
}

export function terminalRuntimeIdleDeadline(now = Date.now()) {
  return new Date(now + TERMINAL_RUNTIME_IDLE_TIMEOUT_MS);
}

export function shouldReclaimTerminalRuntime(
  runtimeIdleExpiresAt: Date | number,
  workspacePresenceExpiresAt: Date | null,
  now = Date.now(),
) {
  const runtimeExpired = (runtimeIdleExpiresAt instanceof Date ? runtimeIdleExpiresAt.getTime() : runtimeIdleExpiresAt) <= now;
  const workspacePresenceExpired = !workspacePresenceExpiresAt || workspacePresenceExpiresAt.getTime() <= now;
  return runtimeExpired && workspacePresenceExpired;
}

export const ACTIVE_WORKSPACE_STATUSES = [
  "PENDING",
  "CREATING",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "DELETING",
  "ERROR",
] as const;

export const workspaceErrorCode = {
  conflict: "CONTAINER_CONFLICT",
  ownership: "CONTAINER_OWNERSHIP_CONFLICT",
  missing: "CONTAINER_MISSING",
  startupConflict: "WORKSPACE_CONFLICT",
} as const;

export function hasWorkspaceError(error: string | null | undefined, code: string) {
  return error === code || error?.startsWith(`${code}:`) === true;
}

export function publicError(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : fallback;
  const allowed = new Set([
    "INVALID_PROJECT_ID",
    "INVALID_WORKSPACE_ID",
    "LEASE_CONFLICT",
    "LEASE_CLEANUP_PENDING",
    "LEASE_NOT_RELEASABLE",
    "PROJECT_NOT_READY",
    "WORKSPACE_CONFLICT",
    "WORKSPACE_NOT_FOUND",
    "WORKSPACE_NOT_RUNNING",
    "WORKSPACE_NOT_STOPPED",
    "WORKSPACE_ACCESS_DENIED",
    "CONTAINER_CONFLICT",
  ]);
  return allowed.has(code) ? code : fallback;
}
