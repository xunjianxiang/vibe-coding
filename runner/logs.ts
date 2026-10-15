import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkspaceLogChannel = "startup" | "service";
export type WorkspaceLogStream = "console" | "stdout" | "stderr" | "system";

export type WorkspaceLogEntry = {
  timestamp: string;
  level: "info" | "error";
  channel: WorkspaceLogChannel;
  stream: WorkspaceLogStream;
  message: string;
  serviceId?: string;
  logName?: string;
};

export type WorkspaceServiceLog = {
  name: string;
  path: string;
  stream?: WorkspaceLogStream;
  /** Cursor key used only when reading catalogs written by older Runner versions. */
  cursorKey?: string;
};

export type WorkspaceService = {
  id: string;
  name: string;
  kind: "process" | "container";
  port?: number;
  browser?: boolean;
  logs: WorkspaceServiceLog[];
  command?: string;
};

export type ServiceLogCursor = { identity: string; lines: number };

export const WORKSPACE_LOG_DIR = path.join(
  path.resolve(/* turbopackIgnore: true */ process.env.APP_ROOT || process.cwd()),
  ".runner",
  "logs",
);

const WORKSPACE_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function assertWorkspaceId(workspaceId: string) {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) throw new Error("Invalid workspace ID.");
}

export function isServiceId(value: string) {
  return SERVICE_ID_PATTERN.test(value);
}

function workspaceLogRoot(workspaceId: string) {
  assertWorkspaceId(workspaceId);
  return path.join(WORKSPACE_LOG_DIR, workspaceId);
}

export function workspaceLogPath(workspaceId: string, channel: WorkspaceLogChannel, serviceId?: string) {
  const root = workspaceLogRoot(workspaceId);
  if (channel === "startup") return path.join(root, "startup.jsonl");
  if (!serviceId || !isServiceId(serviceId)) throw new Error("Invalid service ID.");
  return path.join(root, "services", `${serviceId}.jsonl`);
}

export async function readWorkspaceLogSnapshot(
  workspaceId: string,
  channel: WorkspaceLogChannel,
  serviceId?: string,
  limit = 200,
) {
  try {
    const content = await readFile(workspaceLogPath(workspaceId, channel, serviceId), "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const entries = lines.slice(-limit).flatMap((line) => {
      try {
        return [JSON.parse(line) as WorkspaceLogEntry];
      } catch {
        return [];
      }
    });
    return { entries, offset: lines.length };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], offset: 0 };
    throw error;
  }
}

export async function appendWorkspaceLog(
  workspaceId: string,
  entry: Omit<WorkspaceLogEntry, "timestamp"> & { timestamp?: string },
) {
  const logPath = workspaceLogPath(workspaceId, entry.channel, entry.serviceId);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() })}\n`, "utf8");
}

function serviceCatalogPath(workspaceId: string) {
  return path.join(workspaceLogRoot(workspaceId), "services.json");
}

export async function readWorkspaceServices(workspaceId: string): Promise<WorkspaceService[]> {
  try {
    const value = JSON.parse(await readFile(serviceCatalogPath(workspaceId), "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((service): WorkspaceService[] => {
      if (!service || typeof service !== "object") return [];
      const candidate = service as Record<string, unknown>;
      if (typeof candidate.id !== "string" || !isServiceId(candidate.id)
        || typeof candidate.name !== "string"
        || (candidate.kind !== "process" && candidate.kind !== "container")) return [];

      let logs: WorkspaceServiceLog[];
      if (Array.isArray(candidate.logs)) {
        if (!candidate.logs.every((log) => log && typeof log === "object"
          && typeof (log as Record<string, unknown>).name === "string"
          && typeof (log as Record<string, unknown>).path === "string")) return [];
        logs = candidate.logs.map((log) => ({
          name: (log as Record<string, string>).name,
          path: (log as Record<string, string>).path,
          stream: ["console", "stdout", "stderr"].includes((log as Record<string, string>).stream)
            ? (log as Record<string, string>).stream as WorkspaceLogStream
            : "console",
        }));
      } else if (typeof candidate.log === "string") {
        logs = [{ name: path.posix.basename(candidate.log), path: candidate.log, cursorKey: "console" }];
      } else if (candidate.logs && typeof candidate.logs === "object"
        && typeof (candidate.logs as Record<string, unknown>).stdout === "string"
        && typeof (candidate.logs as Record<string, unknown>).stderr === "string") {
        const legacyLogs = candidate.logs as Record<string, string>;
        logs = [
          { name: "stdout", path: legacyLogs.stdout, cursorKey: "stdout" },
          { name: "stderr", path: legacyLogs.stderr, cursorKey: "stderr" },
        ];
      } else {
        logs = [];
      }

      return [{
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        port: Number.isInteger(candidate.port) && (candidate.port as number) >= 1 && (candidate.port as number) <= 65_535
          ? candidate.port as number
          : undefined,
        browser: candidate.browser === true,
        logs,
        command: typeof candidate.command === "string" ? candidate.command : undefined,
      }];
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function hasWorkspaceServiceCatalog(workspaceId: string) {
  try {
    await access(serviceCatalogPath(workspaceId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function writeWorkspaceServices(workspaceId: string, services: WorkspaceService[]) {
  const target = serviceCatalogPath(workspaceId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(services, null, 2), "utf8");
  await rename(temporary, target);
}

function serviceCursorPath(workspaceId: string) {
  return path.join(workspaceLogRoot(workspaceId), "service-cursors.json");
}

export async function readServiceLogCursors(workspaceId: string): Promise<Record<string, ServiceLogCursor>> {
  try {
    const value = JSON.parse(await readFile(serviceCursorPath(workspaceId), "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, candidate]) => {
      if (Number.isSafeInteger(candidate) && (candidate as number) >= 0) {
        return [[key, { identity: "", lines: candidate as number }] as const];
      }
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const cursor = candidate as Partial<ServiceLogCursor>;
      if (typeof cursor.identity !== "string" || !Number.isSafeInteger(cursor.lines) || cursor.lines! < 0) return [];
      return [[key, { identity: cursor.identity, lines: cursor.lines! }] as const];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeServiceLogCursors(workspaceId: string, cursors: Record<string, ServiceLogCursor>) {
  const target = serviceCursorPath(workspaceId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(cursors), "utf8");
  await rename(temporary, target);
}
