import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  appendWorkspaceLog,
  isServiceId,
  writeWorkspaceServices,
  type ServiceLogCursor,
  type WorkspaceService,
} from "@/runner/logs";
import { run } from "@/runner/process";

type ServiceManifest = {
  services: Array<{
    id: string;
    name: string;
    port?: string | number;
    browser?: boolean;
    command: string;
    stdout: string;
    logs?: Array<{ name: string; path: string }>;
  }>;
};

export const SERVICE_LOG_MANIFEST_PATH = path.join(".devcontainer", "metadata.json");
const SERVICE_LOG_LINE_BYTES = 16 * 1024;
const cursorCache = new Map<string, Record<string, ServiceLogCursor>>();
const syncQueues = new Map<string, Promise<void>>();

async function serializeLogSync(workspaceId: string, task: () => Promise<void>) {
  const previous = syncQueues.get(workspaceId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  syncQueues.set(workspaceId, next);
  try {
    await next;
  } finally {
    if (syncQueues.get(workspaceId) === next) syncQueues.delete(workspaceId);
  }
}

function parseLogPath(value: unknown, serviceId: string) {
  if (typeof value !== "string" || !path.posix.isAbsolute(value) || value.length > 4_096 || /[\0\r\n]/.test(value)) {
    throw new Error(`Service ${serviceId} must define an absolute log path.`);
  }
  return value;
}

function parseManifest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Service log manifest must be an object.");
  const manifest = value as Partial<ServiceManifest>;
  if (!Array.isArray(manifest.services)) throw new Error("Service manifest must define a services array.");
  const serviceIds = new Set<string>();
  const services = manifest.services.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || !isServiceId(candidate.id)) {
      throw new Error("Each service id must match [a-z0-9][a-z0-9_-]{0,63}.");
    }
    if (serviceIds.has(candidate.id)) throw new Error(`Duplicate service id: ${candidate.id}`);
    serviceIds.add(candidate.id);
    if (typeof candidate.name !== "string" || candidate.name.trim().length === 0 || candidate.name.length > 100) {
      throw new Error(`Service ${candidate.id} must define a name of at most 100 characters.`);
    }
    if (typeof candidate.command !== "string" || candidate.command.trim().length === 0 || candidate.command.length > 8_192 || candidate.command.includes("\0")) {
      throw new Error(`Service ${candidate.id} must define a command of at most 8192 characters.`);
    }
    let port: number | undefined;
    if (candidate.port !== undefined) {
      if (typeof candidate.port === "number") port = candidate.port;
      else if (/^\d+$/.test(candidate.port)) port = Number(candidate.port);
      if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Service ${candidate.id} port must be an integer from 1 to 65535.`);
      }
    }
    if (candidate.browser !== undefined && typeof candidate.browser !== "boolean") {
      throw new Error(`Service ${candidate.id} browser must be a boolean.`);
    }
    const stdout = parseLogPath(candidate.stdout, candidate.id);
    if (candidate.logs !== undefined && !Array.isArray(candidate.logs)) throw new Error(`Service ${candidate.id} logs must be an array.`);
    const logNames = new Set<string>();
    const logs = (candidate.logs ?? []).map((log) => {
      if (!log || typeof log !== "object" || typeof log.name !== "string" || !isServiceId(log.name)) {
        throw new Error(`Each log name for service ${candidate.id} must match [a-z0-9][a-z0-9_-]{0,63}.`);
      }
      if (log.name === "stdout") throw new Error(`Service ${candidate.id} log name stdout is reserved.`);
      if (logNames.has(log.name)) throw new Error(`Duplicate log name for service ${candidate.id}: ${log.name}`);
      logNames.add(log.name);
      return { name: log.name, path: parseLogPath(log.path, candidate.id) };
    });
    return {
      id: candidate.id,
      name: candidate.name.trim(),
      port,
      browser: candidate.browser ?? false,
      command: candidate.command,
      stdout,
      logs,
    };
  });
  return { services };
}

export async function loadProcessServices(workspacePath: string): Promise<WorkspaceService[]> {
  const manifestPath = path.join(workspacePath, SERVICE_LOG_MANIFEST_PATH);
  try {
    const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
    return manifest.services.map((service) => ({
      id: service.id,
      name: service.name,
      port: service.port,
      browser: service.browser,
      command: service.command,
      kind: "process" as const,
      logs: [
        { name: "stdout", path: service.stdout, stream: "stdout" as const },
        ...(service.logs ?? []).map((log) => ({ ...log, stream: "console" as const })),
      ],
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Invalid .devcontainer/metadata.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readLogLines(containerId: string, filePath: string, cursor: ServiceLogCursor) {
  const script = [
    "file=$1; previous=$2; previous_identity=$3; start=$((previous + 1))",
    "if [ ! -f \"$file\" ] || [ -L \"$file\" ] || [ ! -r \"$file\" ]; then printf '\\n0\\n'; exit 0; fi",
    "identity=$(stat -c '%d:%i' \"$file\")",
    "count=$(wc -l < \"$file\")",
    "printf '%s\\n%s\\n' \"$identity\" \"$count\"",
    "if [ -z \"$previous_identity\" ] || [ \"$identity\" != \"$previous_identity\" ] || [ \"$count\" -lt \"$previous\" ]; then start=$((count > 200 ? count - 199 : 1)); fi",
    `if [ "$count" -ge "$start" ]; then sed -n "\${start},\${count}p" "$file" | awk -v max=${SERVICE_LOG_LINE_BYTES} '{ if (length($0) > max) print substr($0, 1, max) "... [truncated]"; else print }'; fi`,
  ].join("; ");
  const { stdout } = await run("docker", ["exec", containerId, "sh", "-c", script, "vibe-log-reader", filePath, String(cursor.lines), cursor.identity]);
  const lines = stdout.split(/\r?\n/);
  const identity = lines.shift() ?? "";
  const count = Number(lines.shift());
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Unable to read service log ${filePath}.`);
  if (lines.at(-1) === "") lines.pop();
  return { cursor: { identity, lines: count }, lines };
}

async function getCursors(workspaceId: string) {
  const cached = cursorCache.get(workspaceId);
  if (cached) return cached;
  const cursors: Record<string, ServiceLogCursor> = {};
  cursorCache.set(workspaceId, cursors);
  return cursors;
}

export async function resetProcessServiceCursors(workspaceId: string, serviceId: string) {
  await serializeLogSync(workspaceId, async () => {
    const cursors = await getCursors(workspaceId);
    for (const key of Object.keys(cursors)) {
      if (key.startsWith(`${serviceId}:`)) delete cursors[key];
    }
  });
}

export async function registerProcessServices(workspaceId: string, workspacePath: string) {
  const services = await loadProcessServices(workspacePath);
  await writeWorkspaceServices(workspaceId, services);
  return services;
}

export async function syncProcessServiceLogs(workspaceId: string, containerId: string, services: WorkspaceService[]) {
  await serializeLogSync(workspaceId, async () => {
    const cursors = await getCursors(workspaceId);
    for (const service of services.filter((candidate) => candidate.kind === "process")) {
      for (const source of service.logs) {
        const key = source.cursorKey
          ? `${service.id}:${source.cursorKey}`
          : `${service.id}:log:${encodeURIComponent(source.name)}`;
        const result = await readLogLines(containerId, source.path, cursors[key] ?? { identity: "", lines: 0 });
        for (const message of result.lines) {
          await appendWorkspaceLog(workspaceId, {
            channel: "service",
            serviceId: service.id,
            logName: source.name,
            stream: source.stream ?? "console",
            level: "info",
            message,
          });
        }
        cursors[key] = result.cursor;
      }
    }
  });
}
