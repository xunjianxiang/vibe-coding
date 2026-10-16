import type { ServerResponse } from "node:http";
import type { WorkspaceLogChannel, WorkspaceLogEntry } from "@/runner/logs";

export const WORKSPACE_LOG_BUFFER_ENTRIES = 500;
export const WORKSPACE_LOG_BUFFER_BYTES = 1024 * 1024;
export const WORKSPACE_LOG_REPLAY_ENTRIES = 200;
export const WORKSPACE_LOG_MESSAGE_BYTES = 64 * 1024;

const SSE_HEARTBEAT_MS = 15_000;
const SSE_MAX_PENDING_BYTES = 2 * 1024 * 1024;
const TRUNCATION_SUFFIX = "... [truncated]";

type LogSelector = {
  workspaceId: string;
  channel: WorkspaceLogChannel;
  serviceId?: string;
};

type BufferedLog = {
  id: number;
  entry: WorkspaceLogEntry;
  bytes: number;
};

type LogBuffer = {
  entries: BufferedLog[];
  bytes: number;
  nextId: number;
  listeners: Set<(entry: BufferedLog) => void>;
};

type LogStreamOptions = {
  maxEntries?: number;
  maxBytes?: number;
  replayEntries?: number;
};

function streamKey({ workspaceId, channel, serviceId }: LogSelector) {
  return `${workspaceId}\0${channel}\0${serviceId ?? ""}`;
}

function serializedBytes(entry: WorkspaceLogEntry) {
  return Buffer.byteLength(JSON.stringify(entry), "utf8");
}

function truncateUtf8(value: string, maxBytes: number) {
  const source = Buffer.from(value, "utf8");
  if (source.length <= maxBytes) return value;
  const suffix = Buffer.from(TRUNCATION_SUFFIX, "utf8");
  const prefixLength = Math.max(0, maxBytes - suffix.length);
  let prefix = source.subarray(0, prefixLength).toString("utf8");
  if (prefix.endsWith("\ufffd")) prefix = prefix.slice(0, -1);
  return `${prefix}${TRUNCATION_SUFFIX}`;
}

export function normalizeWorkspaceLogEntry(entry: WorkspaceLogEntry): WorkspaceLogEntry {
  return { ...entry, message: truncateUtf8(entry.message, WORKSPACE_LOG_MESSAGE_BYTES) };
}

export class WorkspaceLogStreamHub {
  private readonly buffers = new Map<string, LogBuffer>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly replayEntries: number;

  constructor(options: LogStreamOptions = {}) {
    this.maxEntries = options.maxEntries ?? WORKSPACE_LOG_BUFFER_ENTRIES;
    this.maxBytes = options.maxBytes ?? WORKSPACE_LOG_BUFFER_BYTES;
    this.replayEntries = options.replayEntries ?? WORKSPACE_LOG_REPLAY_ENTRIES;
  }

  append(selector: LogSelector, value: WorkspaceLogEntry) {
    const key = streamKey(selector);
    const buffer = this.buffers.get(key) ?? { entries: [], bytes: 0, nextId: 1, listeners: new Set() };
    if (!this.buffers.has(key)) this.buffers.set(key, buffer);

    const entry = normalizeWorkspaceLogEntry(value);
    const buffered = { id: buffer.nextId++, entry, bytes: serializedBytes(entry) };
    buffer.entries.push(buffered);
    buffer.bytes += buffered.bytes;
    while (buffer.entries.length > this.maxEntries || buffer.bytes > this.maxBytes) {
      const removed = buffer.entries.shift();
      if (!removed) break;
      buffer.bytes -= removed.bytes;
    }
    for (const listener of buffer.listeners) listener(buffered);
    return buffered;
  }

  subscribe(selector: LogSelector, lastEventId: number | undefined, listener: (entry: BufferedLog) => void) {
    const key = streamKey(selector);
    const buffer = this.buffers.get(key) ?? { entries: [], bytes: 0, nextId: 1, listeners: new Set() };
    if (!this.buffers.has(key)) this.buffers.set(key, buffer);
    buffer.listeners.add(listener);

    const oldestId = buffer.entries[0]?.id;
    const latestId = buffer.entries.at(-1)?.id;
    const cursorAvailable = lastEventId !== undefined
      && (oldestId === undefined || (lastEventId >= oldestId - 1 && lastEventId <= latestId!));
    const replay = cursorAvailable
      ? buffer.entries.filter((entry) => entry.id > lastEventId)
      : buffer.entries.slice(-this.replayEntries);

    return {
      replay,
      unsubscribe: () => {
        buffer.listeners.delete(listener);
        if (buffer.entries.length === 0 && buffer.listeners.size === 0) this.buffers.delete(key);
      },
    };
  }
}

export const workspaceLogStreamHub = new WorkspaceLogStreamHub();

export function parseLastEventId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function encodeEvent(entry: BufferedLog) {
  return `id: ${entry.id}\ndata: ${JSON.stringify(entry.entry)}\n\n`;
}

export function pipeWorkspaceLogSse(
  response: ServerResponse,
  selector: LogSelector,
  lastEventId: number | undefined,
) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let blocked = false;
  let closed = false;
  let pendingBytes = 0;
  let unsubscribe: () => void = () => undefined;
  const timers: { heartbeat?: NodeJS.Timeout } = {};
  const pending: string[] = [];

  const close = () => {
    if (closed) return;
    closed = true;
    if (timers.heartbeat) clearInterval(timers.heartbeat);
    unsubscribe();
  };
  const write = (chunk: string) => {
    if (closed) return;
    if (blocked) {
      pending.push(chunk);
      pendingBytes += Buffer.byteLength(chunk, "utf8");
      if (pendingBytes > SSE_MAX_PENDING_BYTES) response.destroy(new Error("Log stream client is too slow."));
      return;
    }
    blocked = !response.write(chunk);
  };
  const flush = () => {
    blocked = false;
    while (!blocked && pending.length > 0) {
      const chunk = pending.shift()!;
      pendingBytes -= Buffer.byteLength(chunk, "utf8");
      blocked = !response.write(chunk);
    }
  };

  const subscription = workspaceLogStreamHub.subscribe(selector, lastEventId, (entry) => write(encodeEvent(entry)));
  unsubscribe = subscription.unsubscribe;
  response.on("drain", flush);
  response.once("close", close);
  response.once("error", close);
  blocked = !response.write(`retry: 2000\n\n${subscription.replay.map(encodeEvent).join("")}`);
  timers.heartbeat = setInterval(() => write(`: heartbeat ${Date.now()}\n\n`), SSE_HEARTBEAT_MS);
  timers.heartbeat.unref();
}
