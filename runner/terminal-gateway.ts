import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { finished } from "node:stream/promises";
import Docker from "dockerode";
import { WebSocket, WebSocketServer } from "ws";
import type { CodexSessionStatus, PrismaClient } from "@prisma/client";
import { verifyTerminalTicket, type TerminalAgent, type TerminalKind, type TerminalTicket } from "@/lib/terminal-ticket";
import { verifyRealtimeTicket } from "@/lib/realtime-ticket";
import { RUNNER_SOCKET_IS_FILESYSTEM, RUNNER_SOCKET_PATH } from "@/lib/runner-socket";
import { isWebSocketOriginAllowed } from "@/lib/trusted-origins";
import {
  CODEX_HOME_CONTAINER_PATH,
  CODEX_SQLITE_HOME_CONTAINER_PATH,
  shouldReclaimTerminalRuntime,
  terminalRuntimeIdleDeadline,
  workspaceErrorCode,
} from "@/lib/workspace-policy";
import { getAgentLaunchSpec, getAgentSessionDiscoveryCommand, parseAgentSessionId } from "@/runner/agent-runtime";
import { removeOrphanContainer } from "@/runner/container-cleanup";
import { addRealtimeClient } from "@/runner/realtime-hub";
import { isServiceId, type WorkspaceLogChannel } from "@/runner/logs";
import { parseLastEventId, pipeWorkspaceLogSse } from "@/runner/log-stream";

const MAX_REPLAY_BYTES = 256 * 1024;
const MAX_CLIENT_BUFFER = 1024 * 1024;
const LEGACY_CODEX_HOME_CONTAINER_PATH = "/var/lib/vibe-coding/codex";

type Runtime = {
  key: string;
  container: Docker.Container;
  exec: Docker.Exec;
  stream: Duplex;
  writer: WebSocket | null;
  replay: Buffer;
  pidFile: string;
  remoteUser: string;
  sessionId: string | null;
  nativeSessionId: string | null;
  agentHome: string | null;
  agentSessionMarker: string | null;
  sessionCaptureTimer: NodeJS.Timeout | null;
  sessionCapturePromise: Promise<void> | null;
  runtimeId: string;
  kind: TerminalKind;
  agent?: TerminalAgent;
  stopping: boolean;
  finalizing: boolean;
  finalized: boolean;
  workspaceFolder: string;
  workspaceId: string;
  terminalId: string;
  lastActivityAt: number;
  idleExpiresAt: number;
  activityPersistTimer: NodeJS.Timeout | null;
};

type TerminalControlMessage = {
  type?: "resize" | "close";
  cols?: number;
  rows?: number;
};

const runtimes = new Map<string, Runtime>();
let runtimeDb: PrismaClient | null = null;

function runtimeKey(workspaceId: string, terminalId: string) {
  return `${workspaceId}:${terminalId}`;
}

function runtimePidFile(workspaceId: string, terminalId: string) {
  return `/tmp/vibe-coding-terminal-${createHash("sha256").update(runtimeKey(workspaceId, terminalId)).digest("hex").slice(0, 24)}.pid`;
}

function terminalLocation(info: Docker.ContainerInspectInfo, hostPath: string) {
  const mount = info.Mounts.find((candidate) => candidate.Type === "bind" && candidate.Source.toLowerCase() === hostPath.toLowerCase());
  let remoteUser: string | undefined;
  const metadata = info.Config.Labels?.["devcontainer.metadata"];
  if (metadata) {
    try {
      const entries = JSON.parse(metadata) as Array<{ remoteUser?: string }>;
      remoteUser = entries.findLast((entry) => entry.remoteUser)?.remoteUser;
    } catch {
      // Malformed metadata is rejected below instead of falling back to root.
    }
  }
  if (!remoteUser) throw new Error("Dev Container remoteUser is required for the Codex terminal.");
  return { remoteUser, workspaceFolder: mount?.Destination || "/workspaces" };
}

async function runtimeAuthorized(db: PrismaClient, workspaceId: string, sub?: string, terminalId?: string) {
  const workspace = await db.workspace.findFirst({
    where: {
      id: workspaceId,
      ...(sub ? { sub } : {}),
      status: "RUNNING",
      desiredState: "RUNNING",
      OR: [
        { error: null },
        { error: { not: { startsWith: workspaceErrorCode.conflict } } },
      ],
      project: { lease: { is: { ...(sub ? { sub } : {}), workspaceId, state: "DEVELOPING" } } },
    },
    select: { id: true },
  });
  if (!workspace) return false;
  if (!terminalId) return true;
  return !!await db.terminal.findFirst({
    where: { id: terminalId, workspaceId, desiredState: "OPEN", ...(sub ? { sub } : {}) },
    select: { id: true },
  });
}

function touchRuntime(runtime: Runtime) {
  const now = Date.now();
  runtime.lastActivityAt = now;
  runtime.idleExpiresAt = terminalRuntimeIdleDeadline(now).getTime();
  if (runtime.activityPersistTimer) return;
  runtime.activityPersistTimer = setTimeout(() => {
    runtime.activityPersistTimer = null;
    void runtimeDb?.terminalRuntime.updateMany({
      where: { id: runtime.runtimeId, activeKey: runtime.terminalId, status: "RUNNING" },
      data: {
        lastActivityAt: new Date(runtime.lastActivityAt),
        idleExpiresAt: new Date(runtime.idleExpiresAt),
      },
    }).catch(console.error);
  }, 1_000);
}

export async function hasActiveWorkspaceTerminalRuntime(db: PrismaClient, workspaceId: string) {
  const now = Date.now();
  if ([...runtimes.values()].some((runtime) => runtime.workspaceId === workspaceId && !runtime.stopping && runtime.idleExpiresAt > now)) {
    return true;
  }
  return await db.terminalRuntime.count({
    where: { workspaceId, status: { in: ["STARTING", "RUNNING"] }, idleExpiresAt: { gt: new Date(now) } },
  }) > 0;
}

async function stopLegacyAgentDaemon(container: Docker.Container, terminalId: string) {
  const cleanup = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    User: "root",
    Env: [`AGENT_HOME=${LEGACY_CODEX_HOME_CONTAINER_PATH}/terminals/${terminalId}`],
    Cmd: [
      "sh",
      "-lc",
      "set -eu; signal_daemons() { signal=$1; for file in \"$AGENT_HOME\"/app-server-daemon/*.pid; do [ -f \"$file\" ] || continue; pid=$(sed -n 's/.*\"pid\":\\([0-9][0-9]*\\).*/\\1/p' \"$file\"); [ -n \"$pid\" ] || continue; [ -r \"/proc/$pid/environ\" ] || continue; if tr '\\0' '\\n' < \"/proc/$pid/environ\" | grep -Fqx \"CODEX_HOME=$AGENT_HOME\"; then kill -\"$signal\" \"$pid\" 2>/dev/null || true; fi; done; }; signal_daemons TERM; sleep 0.5; signal_daemons KILL",
    ],
  });
  const stream = await cleanup.start({ hijack: true, stdin: false, Tty: false }) as unknown as Duplex;
  stream.resume();
  await finished(stream).catch(() => undefined);
}

async function captureNativeSessionId(runtime: Runtime) {
  if (!runtime.agent || !runtime.agentHome || !runtime.agentSessionMarker || !runtime.sessionId || runtime.nativeSessionId) return;
  const agent = runtime.agent;
  const agentHome = runtime.agentHome;
  const agentSessionMarker = runtime.agentSessionMarker;
  const sessionId = runtime.sessionId;
  if (runtime.sessionCapturePromise) return runtime.sessionCapturePromise;
  runtime.sessionCapturePromise = (async () => {
    try {
      const nativeSessionId = await discoverNativeSessionId(
        runtime.container,
        runtime.remoteUser,
        runtime.workspaceFolder,
        agent,
        agentHome,
        agentSessionMarker,
      );
      if (!nativeSessionId) return;
      const updated = await runtimeDb?.codexSession.updateMany({
        where: { id: sessionId, nativeSessionId: null },
        data: { nativeSessionId },
      });
      if (!updated || updated.count !== 1) return;
      runtime.nativeSessionId = nativeSessionId;
      if (runtime.sessionCaptureTimer) {
        clearInterval(runtime.sessionCaptureTimer);
        runtime.sessionCaptureTimer = null;
      }
    } catch (error) {
      console.error(`Unable to capture native session for terminal ${runtime.terminalId}:`, error);
    }
  })().finally(() => {
    runtime.sessionCapturePromise = null;
  });
  return runtime.sessionCapturePromise;
}

async function discoverNativeSessionId(
  container: Docker.Container,
  remoteUser: string,
  workspaceFolder: string,
  agent: TerminalAgent,
  agentHome: string,
  markerPath: string,
) {
  const discovery = await container.exec({
    AttachStdout: true,
    AttachStderr: false,
    Tty: true,
    User: remoteUser,
    WorkingDir: workspaceFolder,
    Cmd: ["sh", "-lc", getAgentSessionDiscoveryCommand(agent, agentHome, markerPath)],
  });
  const chunks: Buffer[] = [];
  const stream = await discovery.start({ hijack: true, stdin: false, Tty: true }) as unknown as Duplex;
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  await finished(stream);
  const result = await discovery.inspect();
  if (result.ExitCode !== 0) return null;
  return parseAgentSessionId(agent, Buffer.concat(chunks).toString("utf8"));
}

async function cleanupPersistedRuntimes(db: PrismaClient, docker: Docker) {
  const stale = await db.terminalRuntime.findMany({
    where: { status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
    include: {
      terminal: { select: { kind: true } },
      workspace: { select: { id: true, projectId: true, path: true } },
    },
  });
  for (const persisted of stale) {
    try {
      const container = docker.getContainer(persisted.containerId);
      const info = await container.inspect();
      if (!info.State.Running
        || info.Config.Labels?.["platform.workspace_id"] !== persisted.workspaceId
        || info.Config.Labels?.["platform.project_id"] !== persisted.workspace.projectId) continue;
      const { remoteUser, workspaceFolder } = terminalLocation(info, persisted.workspace.path);
      if (persisted.execId) {
        const exec = docker.getExec(persisted.execId);
        if ((await exec.inspect().catch(() => null))?.Running) {
          for (const signal of ["TERM", "KILL"] as const) {
            const signalExec = await container.exec({
              AttachStdout: true,
              AttachStderr: true,
              Tty: false,
              User: remoteUser,
              WorkingDir: workspaceFolder,
              Env: [`VIBE_TERMINAL_PID_FILE=${runtimePidFile(persisted.workspaceId, persisted.terminalId)}`],
              Cmd: ["sh", "-lc", `pid=$(cat "$VIBE_TERMINAL_PID_FILE" 2>/dev/null) && kill -${signal} -"$pid" 2>/dev/null`],
            });
            const signalStream = await signalExec.start({ hijack: true, stdin: false, Tty: false }) as unknown as Duplex;
            signalStream.resume();
            await finished(signalStream).catch(() => undefined);
            await new Promise((resolve) => setTimeout(resolve, signal === "TERM" ? 500 : 100));
            if (!(await exec.inspect().catch(() => null))?.Running) break;
          }
        }
      }
      if (persisted.terminal.kind === "AGENT") await stopLegacyAgentDaemon(container, persisted.terminalId);
    } catch (error) {
      console.error(`Unable to clean up stale terminal runtime ${persisted.id}:`, error);
    }
  }
}

async function signalRuntime(runtime: Runtime, signal: "TERM" | "KILL") {
  const inspected = await runtime.exec.inspect().catch(() => null);
  if (!inspected?.Running) return;
  const signalExec = await runtime.container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    User: runtime.remoteUser,
    WorkingDir: runtime.workspaceFolder,
    Env: [`VIBE_TERMINAL_PID_FILE=${runtime.pidFile}`],
    Cmd: [
      "sh",
      "-lc",
      `pid=$(cat "$VIBE_TERMINAL_PID_FILE" 2>/dev/null) && kill -${signal} -"$pid" 2>/dev/null`,
    ],
  });
  const signalStream = await signalExec.start({ hijack: true, stdin: false, Tty: false }) as unknown as Duplex;
  signalStream.resume();
  await finished(signalStream).catch(() => undefined);
}

async function waitForRuntimeExit(runtime: Runtime, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inspected = await runtime.exec.inspect().catch(() => null);
    if (!inspected?.Running) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function finalizeRuntime(runtime: Runtime, status: CodexSessionStatus, error: string | null = null) {
  if (runtime.finalized || runtime.finalizing) return;
  runtime.finalizing = true;
  await captureNativeSessionId(runtime);
  runtime.finalized = true;
  runtime.finalizing = false;
  if (runtime.activityPersistTimer) clearTimeout(runtime.activityPersistTimer);
  if (runtime.sessionCaptureTimer) clearInterval(runtime.sessionCaptureTimer);
  runtimes.delete(runtime.key);
  const inspected = await runtime.exec.inspect().catch(() => null);
  if (runtime.sessionId) {
    await runtimeDb?.codexSession.updateMany({
      where: { id: runtime.sessionId, status: { in: ["STARTING", "RUNNING"] } },
      data: { status, error, exitCode: inspected?.ExitCode ?? null, endedAt: new Date() },
    }).catch(console.error);
  }
  if (status === "EXITED" || runtime.kind === "shell") {
    const db = runtimeDb;
    if (db) {
      const closedAt = new Date();
      await db.$transaction([
        db.terminal.updateMany({
          where: { id: runtime.terminalId, desiredState: "OPEN" },
          data: { desiredState: "CLOSED", closedAt },
        }),
        db.workspace.updateMany({
          where: { id: runtime.workspaceId, activeTerminalId: runtime.terminalId },
          data: { activeTerminalId: null },
        }),
      ]).catch(console.error);
    }
  }
  await runtimeDb?.terminalRuntime.updateMany({
    where: { id: runtime.runtimeId, status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
    data: {
      status,
      activeKey: null,
      error,
      exitCode: inspected?.ExitCode ?? null,
      lastActivityAt: new Date(runtime.lastActivityAt),
      idleExpiresAt: new Date(runtime.idleExpiresAt),
      endedAt: new Date(),
    },
  }).catch(console.error);
  const writer = runtime.writer;
  runtime.writer = null;
  if (writer?.readyState === WebSocket.OPEN) {
    writer.close(status === "EXITED" ? 1000 : 4001, status === "EXITED" ? "Terminal closed." : error || "Terminal runtime was released.");
  }
}

async function stopRuntime(key: string, status: CodexSessionStatus, reason: string | null = null) {
  const runtime = runtimes.get(key);
  if (!runtime || runtime.stopping) return;
  runtime.stopping = true;
  try {
    await runtimeDb?.terminalRuntime.updateMany({
      where: { id: runtime.runtimeId, status: { in: ["STARTING", "RUNNING"] } },
      data: { status: "STOPPING" },
    });
    await signalRuntime(runtime, "TERM");
    if (!(await waitForRuntimeExit(runtime, 2_000))) {
      await signalRuntime(runtime, "KILL");
      if (!(await waitForRuntimeExit(runtime, 1_000))) {
        throw new Error("Codex process did not exit after SIGKILL.");
      }
    }
    runtime.stream.end();
    await finalizeRuntime(runtime, status, reason);
  } catch (error) {
    runtime.stopping = false;
    throw error;
  }
}

export async function closeWorkspaceTerminals(workspaceId: string, reason = "Workspace access was revoked.") {
  const workspaceRuntimes = [...runtimes.values()].filter((runtime) => runtime.workspaceId === workspaceId);
  await Promise.all(workspaceRuntimes.map((runtime) => stopRuntime(runtime.key, "INTERRUPTED", reason)));
  const db = runtimeDb;
  if (!db) return;
  const openShells = await db.terminal.findMany({
    where: { workspaceId, kind: "SHELL", desiredState: "OPEN" },
    select: { id: true },
  });
  if (openShells.length === 0) return;
  const shellIds = openShells.map((terminal) => terminal.id);
  const closedAt = new Date();
  await db.$transaction([
    db.terminal.updateMany({
      where: { id: { in: shellIds }, desiredState: "OPEN" },
      data: { desiredState: "CLOSED", closedAt },
    }),
    db.workspace.updateMany({
      where: { id: workspaceId, activeTerminalId: { in: shellIds } },
      data: { activeTerminalId: null },
    }),
  ]);
}

export async function startTerminalGateway(db: PrismaClient, reconcileNow: () => Promise<void>) {
  runtimeDb = db;
  const docker = new Docker();
  await cleanupPersistedRuntimes(db, docker);
  const staleShellTerminals = await db.terminalRuntime.findMany({
    where: {
      status: { in: ["STARTING", "RUNNING", "STOPPING"] },
      terminal: { kind: "SHELL", desiredState: "OPEN" },
    },
    select: { terminalId: true },
    distinct: ["terminalId"],
  });
  const staleShellTerminalIds = staleShellTerminals.map((runtime) => runtime.terminalId);
  const restartedAt = new Date();
  await db.$transaction([
    db.terminal.updateMany({
      where: { id: { in: staleShellTerminalIds }, desiredState: "OPEN" },
      data: { desiredState: "CLOSED", closedAt: restartedAt },
    }),
    db.workspace.updateMany({
      where: { activeTerminalId: { in: staleShellTerminalIds } },
      data: { activeTerminalId: null },
    }),
    db.codexSession.updateMany({
      where: { status: { in: ["STARTING", "RUNNING"] } },
      data: { status: "INTERRUPTED", error: "Terminal Gateway restarted.", endedAt: restartedAt },
    }),
    db.terminalRuntime.updateMany({
      where: { status: { in: ["STARTING", "RUNNING", "STOPPING"] } },
      data: { status: "INTERRUPTED", activeKey: null, error: "Terminal Gateway restarted.", endedAt: restartedAt },
    }),
  ]);
  const server = createServer();
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const realtimeWebSockets = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const realtimeClients = new Map<WebSocket, { sub: string; sessionId: string; alive: boolean }>();
  const runtimeStarts = new Map<string, Promise<Runtime>>();

  async function createRuntime(ticket: TerminalTicket) {
    const key = runtimeKey(ticket.workspaceId, ticket.terminalId);
    const terminal = await db.terminal.findFirst({
      where: { id: ticket.terminalId, workspaceId: ticket.workspaceId, sub: ticket.sub, desiredState: "OPEN" },
      include: { workspace: true },
    });
    const workspace = terminal?.workspace;
    if (!workspace?.containerId || workspace.status !== "RUNNING" || workspace.desiredState !== "RUNNING") {
      throw new Error("Workspace is not running.");
    }
    if (!terminal) throw new Error("Terminal is not open.");
    const kind = terminal.kind.toLowerCase() as TerminalKind;
    const agent = terminal.agent?.toLowerCase() as TerminalAgent | undefined;
    if (kind !== ticket.kind || agent !== ticket.agent) throw new Error("Terminal configuration does not match.");
    const previousSession = agent
      ? await db.codexSession.findFirst({
        where: { terminalId: terminal.id, nativeSessionId: { not: null } },
        orderBy: { startedAt: "desc" },
        select: { nativeSessionId: true },
      })
      : null;
    const nativeSessionId = previousSession?.nativeSessionId ?? null;

    const container = docker.getContainer(workspace.containerId);
    const info = await container.inspect();
    if (!info.State.Running) throw new Error("Workspace container is not running.");
    if (info.Config.Labels?.["platform.managed"] !== "true"
      || info.Config.Labels?.["platform.workspace_id"] !== workspace.id
      || info.Config.Labels?.["platform.project_id"] !== workspace.projectId) {
      throw new Error("Workspace container ownership could not be verified.");
    }
    const { remoteUser, workspaceFolder } = terminalLocation(info, workspace.path);
    const mountedDestinations = new Set(info.Mounts.map((mount) => mount.Destination));
    const sharedCodexStorage = mountedDestinations.has(CODEX_HOME_CONTAINER_PATH)
      && mountedDestinations.has(CODEX_SQLITE_HOME_CONTAINER_PATH);
    if (kind === "agent" && !sharedCodexStorage) throw new Error("Shared Agent session storage is not mounted.");
    const agentHome = agent && sharedCodexStorage ? CODEX_HOME_CONTAINER_PATH : null;
    const pidFile = runtimePidFile(ticket.workspaceId, ticket.terminalId);
    const agentSessionMarker = agent && agentHome
      ? `${agentHome}/.session-start-${terminal.id}-${Date.now()}-${process.pid}`
      : null;
    const agentLaunch = agent && agentHome
      ? getAgentLaunchSpec(agent, agentHome, CODEX_SQLITE_HOME_CONTAINER_PATH, nativeSessionId)
      : null;
    const command = kind === "shell"
      ? "exec \"${SHELL:-/bin/sh}\""
      : agentLaunch!.command;
    const exec = await container.exec({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: remoteUser,
      WorkingDir: workspaceFolder,
      Env: [
        "TERM=xterm-256color",
        "COLORTERM=truecolor",
        "LANG=C.UTF-8",
        `VIBE_TERMINAL_PID_FILE=${pidFile}`,
        ...(agentSessionMarker ? [`VIBE_AGENT_SESSION_MARKER=${agentSessionMarker}`] : []),
        ...(agentLaunch?.env ?? []),
      ],
      Cmd: ["sh", "-lc", `umask 077; printf "%s\\n" "$$" > "$VIBE_TERMINAL_PID_FILE"; ${agentSessionMarker ? "touch \"$VIBE_AGENT_SESSION_MARKER\"; " : ""}${command}`],
    });
    const activityAt = new Date();
    const persistedRuntime = await db.terminalRuntime.create({
      data: {
        terminalId: terminal.id,
        workspaceId: workspace.id,
        containerId: workspace.containerId,
        execId: exec.id,
        activeKey: terminal.id,
        status: "STARTING",
        lastActivityAt: activityAt,
        idleExpiresAt: terminalRuntimeIdleDeadline(activityAt.getTime()),
      },
    });
    let stream: Duplex;
    try {
      stream = await exec.start({ hijack: true, stdin: true, Tty: true }) as unknown as Duplex;
      await db.terminalRuntime.update({ where: { id: persistedRuntime.id }, data: { status: "RUNNING" } });
    } catch (error) {
      await db.terminalRuntime.update({
        where: { id: persistedRuntime.id },
        data: { status: "ERROR", activeKey: null, error: error instanceof Error ? error.message : "Terminal start failed.", endedAt: new Date() },
      });
      throw error;
    }
    const session = kind === "agent"
      ? await db.codexSession.create({
        data: {
          workspaceId: ticket.workspaceId,
          terminalId: terminal.id,
          runtimeId: persistedRuntime.id,
          sub: workspace.sub,
          execId: exec.id,
          nativeSessionId,
          status: "RUNNING",
        },
      })
      : null;
    const runtime: Runtime = {
      key,
      container,
      exec,
      stream,
      writer: null,
      replay: Buffer.alloc(0),
      pidFile,
      remoteUser,
      sessionId: session?.id ?? null,
      nativeSessionId,
      agentHome,
      agentSessionMarker,
      sessionCaptureTimer: null,
      sessionCapturePromise: null,
      runtimeId: persistedRuntime.id,
      kind,
      ...(agent ? { agent } : {}),
      stopping: false,
      finalizing: false,
      finalized: false,
      workspaceFolder,
      workspaceId: ticket.workspaceId,
      terminalId: ticket.terminalId,
      lastActivityAt: activityAt.getTime(),
      idleExpiresAt: terminalRuntimeIdleDeadline(activityAt.getTime()).getTime(),
      activityPersistTimer: null,
    };
    runtimes.set(key, runtime);
    if (agent && !nativeSessionId) {
      runtime.sessionCaptureTimer = setInterval(() => { void captureNativeSessionId(runtime); }, 1_000);
      runtime.sessionCaptureTimer.unref();
      void captureNativeSessionId(runtime);
    }

    stream.on("data", (chunk: Buffer) => {
      touchRuntime(runtime);
      runtime.replay = Buffer.concat([runtime.replay, chunk]).subarray(-MAX_REPLAY_BYTES);
      if (!runtime.writer || runtime.writer.readyState !== WebSocket.OPEN) return;
      if (runtime.writer.bufferedAmount > MAX_CLIENT_BUFFER) {
        runtime.writer.close(1013, "Terminal client is too slow.");
        return;
      }
      runtime.writer.send(chunk, { binary: true });
    });
    stream.once("end", () => {
      if (!runtime.stopping) void finalizeRuntime(runtime, "EXITED");
    });
    stream.once("error", (error) => {
      if (!runtime.stopping) void finalizeRuntime(runtime, "ERROR", error.message);
    });
    return runtime;
  }

  async function getRuntime(ticket: TerminalTicket) {
    const key = runtimeKey(ticket.workspaceId, ticket.terminalId);
    const existing = runtimes.get(key);
    if (existing) {
      if (existing.kind !== ticket.kind || existing.agent !== ticket.agent) throw new Error("Terminal configuration does not match its existing runtime.");
      return existing;
    }
    const pending = runtimeStarts.get(key);
    if (pending) return pending;
    const starting = createRuntime(ticket);
    runtimeStarts.set(key, starting);
    try {
      return await starting;
    } finally {
      runtimeStarts.delete(key);
    }
  }

  const authorizationTimer = setInterval(() => {
    for (const runtime of runtimes.values()) {
      void runtimeAuthorized(db, runtime.workspaceId, undefined, runtime.terminalId).then((authorized) => {
        if (!authorized) return stopRuntime(runtime.key, "INTERRUPTED", "Terminal access was revoked.");
      }).catch((error) => console.error(`Unable to validate terminal ${runtime.workspaceId}:`, error));
    }
  }, 5_000);
  authorizationTimer.unref();

  let idleSweepRunning = false;
  const idleTimer = setInterval(() => {
    if (idleSweepRunning) return;
    idleSweepRunning = true;
    void (async () => {
      const now = Date.now();
      const candidates = [...runtimes.values()].filter((runtime) => !runtime.stopping && runtime.idleExpiresAt <= now);
      if (candidates.length === 0) return;
      const workspaceIds = [...new Set(candidates.map((runtime) => runtime.workspaceId))];
      const workspaces = await db.workspace.findMany({
        where: { id: { in: workspaceIds } },
        select: { id: true, expiresAt: true },
      });
      const presenceByWorkspace = new Map(workspaces.map((workspace) => [workspace.id, workspace.expiresAt]));
      await Promise.all(candidates.map(async (runtime) => {
        const presenceExpiresAt = presenceByWorkspace.get(runtime.workspaceId) ?? null;
        if (!shouldReclaimTerminalRuntime(runtime.idleExpiresAt, presenceExpiresAt, now)) return;
        await stopRuntime(
          runtime.key,
          "INTERRUPTED",
          "Terminal runtime was released after the Workspace page became inactive and terminal input/output remained idle for 10 minutes.",
        );
      }));
    })().catch(console.error).finally(() => {
      idleSweepRunning = false;
    });
  }, 5_000);
  idleTimer.unref();

  const realtimeTimer = setInterval(() => {
    for (const [client, state] of realtimeClients) {
      if (!state.alive) {
        client.terminate();
        continue;
      }
      state.alive = false;
      client.ping();
      void db.session.findUnique({ where: { id: state.sessionId }, select: { sub: true, expiresAt: true } })
        .then((session) => {
          if (!session || session.sub !== state.sub || session.expiresAt <= new Date()) client.close(1008, "Session expired.");
        })
        .catch(() => client.close(1011, "Session validation failed."));
    }
  }, 15_000);
  realtimeTimer.unref();

  server.on("request", (request, response) => {
    void (async () => {
      const url = new URL(request.url || "/", "http://localhost");
      const logMatch = /^\/internal\/workspaces\/([0-9a-f-]{36})\/logs$/i.exec(url.pathname);
      if (request.method === "GET" && logMatch) {
        const channel = url.searchParams.get("channel") as WorkspaceLogChannel | null;
        const serviceId = url.searchParams.get("serviceId") ?? undefined;
        if ((channel !== "startup" && channel !== "service")
          || (channel === "service" && (!serviceId || !isServiceId(serviceId)))) {
          response.writeHead(400).end("Invalid log stream selector.");
          return;
        }
        const lastEventIdHeader = request.headers["last-event-id"];
        pipeWorkspaceLogSse(
          response,
          { workspaceId: logMatch[1], channel, serviceId },
          parseLastEventId(Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader),
        );
        return;
      }
      const match = /^\/internal\/containers\/([a-f0-9]{64})\/cleanup$/.exec(url.pathname);
      if (request.method !== "POST" || !match) {
        response.writeHead(404).end();
        return;
      }

      const result = await removeOrphanContainer(db, docker, match[1]);
      if (result === "NOT_ORPHANED") {
        response.writeHead(409).end();
        return;
      }

      void reconcileNow().catch((error) => {
        console.error("Unable to refresh container inventory after cleanup:", error instanceof Error ? error.message : error);
      });
      response.writeHead(204).end();
    })().catch((error) => {
      console.error("Runner gateway request failed:", error instanceof Error ? error.message : error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  server.on("upgrade", async (request, socket, head) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (!isWebSocketOriginAllowed(request.headers.origin, request.headers.host)) {
        throw new Error("WebSocket origin is not allowed.");
      }
      if (url.pathname === "/ws/events") {
        const ticket = verifyRealtimeTicket(url.searchParams.get("ticket") || "");
        if (!ticket) throw new Error("Realtime ticket is invalid or expired.");
        const session = await db.session.findUnique({ where: { id: ticket.sessionId }, select: { sub: true, expiresAt: true } });
        if (!session || session.sub !== ticket.sub || session.expiresAt <= new Date()) throw new Error("Realtime session is no longer valid.");
        realtimeWebSockets.handleUpgrade(request, socket, head, (client) => {
          const state = { sub: ticket.sub, sessionId: ticket.sessionId, alive: true };
          realtimeClients.set(client, state);
          addRealtimeClient(ticket.sub, client);
          client.on("pong", () => { state.alive = true; });
          client.once("close", () => realtimeClients.delete(client));
          client.send(JSON.stringify({ v: 1, type: "hello", occurredAt: new Date().toISOString() }));
        });
        return;
      }
      if (url.pathname !== "/ws/terminal") throw new Error("WebSocket endpoint is not available.");
      const ticket = verifyTerminalTicket(url.searchParams.get("ticket") || "");
      if (!ticket) throw new Error("Terminal ticket is invalid or expired.");
      if (!(await runtimeAuthorized(db, ticket.workspaceId, ticket.sub, ticket.terminalId))) throw new Error("Terminal access is no longer authorized.");
      const runtime = await getRuntime(ticket);
      if (runtime.writer?.readyState === WebSocket.OPEN) throw new Error("This terminal already has an active writer.");

      webSockets.handleUpgrade(request, socket, head, (client) => {
        runtime.writer = client;
        if (runtime.replay.length) client.send(runtime.replay, { binary: true });
        client.on("message", async (data, isBinary) => {
          if (runtime.writer !== client) return;
          if (!(await runtimeAuthorized(db, ticket.workspaceId, ticket.sub, ticket.terminalId))) {
            await stopRuntime(runtime.key, "INTERRUPTED", "Terminal access was revoked.");
            return;
          }
          if (isBinary) {
            touchRuntime(runtime);
            runtime.stream.write(data);
            return;
          }
          try {
            const message = JSON.parse(data.toString()) as TerminalControlMessage;
            if (message.type === "resize" && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
              await runtime.exec.resize({ w: Math.max(2, message.cols!), h: Math.max(1, message.rows!) });
            } else if (message.type === "close") {
              client.send(JSON.stringify({ type: "closing" }));
              await db.terminal.updateMany({
                where: { id: runtime.terminalId, sub: ticket.sub, desiredState: "OPEN" },
                data: { desiredState: "CLOSED", closedAt: new Date() },
              });
              await stopRuntime(runtime.key, "EXITED");
            } else {
              client.close(1003, "Invalid terminal control message.");
            }
          } catch (error) {
            console.error(`Terminal control failed for ${ticket.workspaceId}:`, error);
            client.close(1011, "Terminal control failed.");
          }
        });
        client.once("close", () => {
          if (runtime.writer !== client || runtime.finalized || runtime.stopping) return;
          runtime.writer = null;
        });
        if (runtime.sessionId) {
          void db.codexSession.updateMany({ where: { id: runtime.sessionId, status: "RUNNING" }, data: { connectedAt: new Date() } });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WebSocket connection rejected.";
      socket.write(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
      socket.destroy();
    }
  });

  const target = RUNNER_SOCKET_PATH;
  if (RUNNER_SOCKET_IS_FILESYSTEM) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.rmSync(target);
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(target, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.once("close", () => {
    clearInterval(authorizationTimer);
    clearInterval(idleTimer);
    clearInterval(realtimeTimer);
  });
  console.log(`Runner Gateway listening on ${target}.`);
  return server;
}
