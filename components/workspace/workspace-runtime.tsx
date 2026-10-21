"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Copy01, Download01, GitBranch01, LinkExternal01, PauseCircle, PlayCircle, RefreshCcw01, StopCircle, Trash01 } from "@untitledui/icons";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { normalizeStartupLogMessage, stripAnsi } from "@/lib/log-output";
import { buildPreviewUrl, findPublishedServicePort } from "@/lib/preview-url";
import { toUserFacingText } from "@/lib/ui-copy";
import { WORKSPACE_ACTIVITY_INTERVAL_MS, WORKSPACE_RESUME_DRIFT_MS } from "@/lib/workspace-policy";

type ServiceOperation = {
  id: string;
  serviceId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  error: string | null;
};

type WorkspaceService = {
  id: string;
  name: string;
  port: number | null;
  browser: boolean;
  gatewayUrl: string | null;
  restartable: boolean;
  operation: ServiceOperation | null;
};

type RuntimeState = {
  status: string;
  error: string | null;
  activeAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
  container: {
    id: string;
    state: string;
    running: boolean;
    anomaly: "ORPHAN" | "PROJECT_CONFLICT" | "OWNERSHIP_CONFLICT" | null;
    observedAt: string | null;
    stoppedAt: string | null;
    exitCode: number | null;
    stopReason: "REQUESTED" | "NORMAL_EXIT" | "PROCESS_ERROR" | "OOM" | "UNKNOWN" | null;
    oomDetected: boolean;
  } | null;
  runner: { dockerStatus: "HEALTHY" | "UNREACHABLE"; eventStreamConnected: boolean; checkedAt: string } | null;
  access: {
    leaseValid: boolean;
    writable: boolean;
    reason: "LEASE_INVALID" | "CONTAINER_CONFLICT" | "CONTAINER_NOT_RUNNING" | "WORKSPACE_NOT_RUNNING" | null;
  };
  ports: Array<{ id: string; containerPort: number; hostPort: number; status: string; url: string | null }>;
  codex: { status: string; error: string | null } | null;
  git: { branch: string; added: number; modified: number; deleted: number } | null;
  services: WorkspaceService[];
};

type LogEntry = {
  timestamp: string;
  level: "info" | "error";
  channel: "startup" | "service";
  stream: "console" | "stdout" | "stderr" | "system";
  message: string;
  serviceId?: string;
};

const statusColor = { PENDING: "blue", CREATING: "blue", STARTING: "blue", RUNNING: "success", STOPPING: "warning", STOPPED: "gray", DELETING: "warning", DELETED: "gray", ERROR: "error" } as const;
const STARTUP_STATUSES = new Set(["PENDING", "CREATING", "STARTING"]);
const ANSI_YELLOW = /\u001b\[[0-9;]*3[3;][0-9;]*m/;
const ANSI_RED = /\u001b\[[0-9;]*3[1;][0-9;]*m/;

type DisplayLogEntry = LogEntry & { tone: "default" | "warning" | "error" };

function cleanLogMessage(entry: LogEntry) {
  const message = entry.channel === "startup" && entry.stream !== "system"
    ? normalizeStartupLogMessage(entry.message)
    : stripAnsi(entry.message);
  return message === null ? null : toUserFacingText(message);
}

function prepareLogEntries(entries: LogEntry[]): DisplayLogEntry[] {
  return entries.flatMap((entry) => {
    const message = cleanLogMessage(entry);
    if (message === null) return [];
    const tone = (entry.level === "error" && entry.stream === "system") || ANSI_RED.test(entry.message)
      ? "error"
      : entry.stream === "stderr" || ANSI_YELLOW.test(entry.message) ? "warning" : "default";
    return [{ ...entry, message, tone }];
  });
}

function formatLogEntries(entries: LogEntry[]) {
  return prepareLogEntries(entries).map((entry) => entry.message).join("\n");
}

function LogViewer({
  workspaceId,
  channel,
  serviceId,
  emptyText,
  className = "h-[440px]",
  showControls = true,
  fillAvailable = false,
  flush = false,
}: {
  workspaceId: string;
  channel: "startup" | "service";
  serviceId?: string;
  emptyText: string;
  className?: string;
  showControls?: boolean;
  fillAvailable?: boolean;
  flush?: boolean;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [streamFailed, setStreamFailed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(true);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const queuedEntriesRef = useRef<LogEntry[]>([]);

  const appendEntries = (incoming: LogEntry[]) => {
    setEntries((current) => {
      const next = [...current, ...incoming];
      return channel === "startup" ? next : next.slice(-500);
    });
  };

  useEffect(() => {
    const query = new URLSearchParams({ channel });
    if (serviceId) query.set("serviceId", serviceId);
    const stream = new EventSource(`/api/workspaces/${workspaceId}/logs?${query}`);
    stream.onopen = () => setStreamFailed(false);
    stream.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        if (pausedRef.current) {
          queuedEntriesRef.current = channel === "startup"
            ? [...queuedEntriesRef.current, entry]
            : [...queuedEntriesRef.current.slice(-499), entry];
          setQueuedCount(queuedEntriesRef.current.length);
        } else {
          appendEntries([entry]);
        }
      } catch { /* Ignore malformed log records. */ }
    };
    stream.onerror = () => setStreamFailed(true);
    return () => stream.close();
  }, [channel, serviceId, workspaceId]);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && isFollowing) panel.scrollTop = panel.scrollHeight;
  }, [entries, isFollowing]);

  const displayEntries = prepareLogEntries(entries);
  const streamLabel = isPaused ? `已暂停${queuedCount > 0 ? ` · ${queuedCount} 条新日志` : ""}` : streamFailed ? "正在重连" : "实时";

  const togglePaused = () => {
    const nextPaused = !pausedRef.current;
    pausedRef.current = nextPaused;
    setIsPaused(nextPaused);
    if (!nextPaused && queuedEntriesRef.current.length > 0) {
      appendEntries(queuedEntriesRef.current);
      queuedEntriesRef.current = [];
      setQueuedCount(0);
      setIsFollowing(true);
    }
  };

  const copyLogs = async () => {
    await navigator.clipboard.writeText(formatLogEntries(entries));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const downloadLogs = () => {
    const blob = new Blob([formatLogEntries(entries)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${serviceId ?? channel}-${new Date().toISOString().replaceAll(":", "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const jumpToLatest = () => {
    setIsFollowing(true);
    const panel = panelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  };

  return (
    <div className={fillAvailable ? "flex h-full min-h-0 flex-col" : undefined}>
      {showControls && <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-tertiary">
          <span className={`size-2 rounded-full ${isPaused ? "bg-utility-yellow-500" : streamFailed ? "bg-utility-red-500" : "bg-utility-green-500"}`} />
          <span>{streamLabel}</span>
          <span className="text-quaternary">{displayEntries.length} 行</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip title={isPaused ? "继续接收" : "暂停显示"}>
            <Button size="xs" color="tertiary" iconLeading={isPaused ? PlayCircle : PauseCircle} aria-label={isPaused ? "继续接收日志" : "暂停日志显示"} onPress={togglePaused} />
          </Tooltip>
          <Tooltip title={copied ? "已复制" : "复制日志"}>
            <Button size="xs" color="tertiary" iconLeading={copied ? Check : Copy01} aria-label="复制日志" isDisabled={entries.length === 0} onPress={() => void copyLogs()} />
          </Tooltip>
          <Tooltip title="下载日志">
            <Button size="xs" color="tertiary" iconLeading={Download01} aria-label="下载日志" isDisabled={entries.length === 0} onPress={downloadLogs} />
          </Tooltip>
          <Tooltip title="清空当前视图">
            <Button size="xs" color="tertiary" iconLeading={Trash01} aria-label="清空当前日志视图" isDisabled={entries.length === 0} onPress={() => setEntries([])} />
          </Tooltip>
        </div>
      </div>}
      <div className={fillAvailable ? "relative min-h-0 flex-1" : "relative"}>
        <div
          ref={panelRef}
          role="log"
          aria-live="off"
          onScroll={(event) => {
            const panel = event.currentTarget;
            setIsFollowing(panel.scrollHeight - panel.scrollTop - panel.clientHeight < 32);
          }}
          className={`${className} ${fillAvailable ? "absolute inset-0" : ""} ${flush ? "" : "rounded-lg ring-1 ring-[#344054]"} overflow-auto bg-[#0c111d] py-2 font-mono text-xs leading-5 text-[#d0d5dd] [scrollbar-color:#475467_#101828]`}
        >
          {displayEntries.length > 0 ? displayEntries.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className={`min-h-5 px-3 whitespace-pre-wrap break-words hover:bg-white/5 ${entry.tone === "error" ? "text-[#fda29b]" : entry.tone === "warning" ? "text-[#fec84b]" : ""}`}
            >
              {entry.message || "\u00a0"}
            </div>
          )) : (
            <p className={`px-3 py-2 ${streamFailed ? "text-[#fda29b]" : "text-[#98a2b3]"}`}>{streamFailed ? "日志连接中断，正在重连..." : emptyText}</p>
          )}
        </div>
        {showControls && !isFollowing && (
          <Button className="absolute right-3 bottom-3 shadow-lg" size="xs" color="secondary" iconLeading={ArrowDown} onPress={jumpToLatest}>最新</Button>
        )}
      </div>
    </div>
  );
}

export function WorkspaceRuntime({
  workspaceId,
  projectId,
  previewHostname,
  initial,
}: {
  workspaceId: string;
  projectId: string;
  previewHostname: string;
  initial: RuntimeState;
}) {
  const [runtime, setRuntime] = useState(initial);
  const [submittingServiceId, setSubmittingServiceId] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<{ serviceId: string; message: string } | null>(null);
  const [workspaceAction, setWorkspaceAction] = useState<"start" | "stop" | null>(null);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);
  const runtimeRef = useRef(runtime);
  const activityInFlightRef = useRef(false);
  const { state: realtimeState, subscribe } = useRealtime();

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  const changeWorkspace = async (action: "start" | "stop") => {
    if (workspaceAction) return;
    setWorkspaceAction(action);
    setWorkspaceActionError(null);
    try {
      const response = await fetch(action === "start" ? `/api/projects/${projectId}/workspaces` : `/api/workspaces/${workspaceId}/stop`, {
        method: "POST",
        headers: action === "start" ? { "Idempotency-Key": createIdempotencyKey() } : undefined,
      });
      const payload = await response.json().catch(() => null) as { status?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Workspace 操作失败。");
      setRuntime((current) => ({
        ...current,
        status: payload?.status ?? (action === "start" ? "PENDING" : "STOPPING"),
        access: { ...current.access, writable: false },
      }));
    } catch (error) {
      setWorkspaceActionError(error instanceof Error ? error.message : "Workspace 操作失败。");
    } finally {
      setWorkspaceAction(null);
    }
  };

  const refreshRuntime = useCallback(async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/status`, { cache: "no-store" });
      if (response.ok) setRuntime(await response.json() as RuntimeState);
    } catch { /* Keep the last known state during a transient request failure. */ }
  }, [workspaceId]);

  useEffect(() => subscribe((message) => {
    if (message.scope?.workspaceId && message.scope.workspaceId !== workspaceId) return;
    if (message.type === "workspace.status.changed" && message.data.status === "STOPPED") {
      setRuntime((current) => ({
        ...current,
        status: "STOPPED",
        container: current.container ? {
          ...current.container,
          running: false,
          state: typeof message.data.containerState === "string" ? message.data.containerState : "exited",
          exitCode: typeof message.data.exitCode === "number" ? message.data.exitCode : null,
          stopReason: typeof message.data.stopReason === "string"
            ? message.data.stopReason as NonNullable<RuntimeState["container"]>["stopReason"]
            : null,
        } : null,
        access: { ...current.access, writable: false, reason: "WORKSPACE_NOT_RUNNING" },
        ports: [],
      }));
    }
    void refreshRuntime();
  }), [refreshRuntime, subscribe, workspaceId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshRuntime(), 0);
    const timer = setInterval(() => void refreshRuntime(), 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refreshRuntime]);

  useEffect(() => {
    if (realtimeState !== "connected") return;
    const timer = window.setTimeout(() => void refreshRuntime(), 0);
    return () => clearTimeout(timer);
  }, [realtimeState, refreshRuntime]);

  useEffect(() => {
    let disposed = false;
    let lastTickAt = Date.now();

    const sendActivity = async () => {
      const current = runtimeRef.current;
      if (disposed
        || document.visibilityState !== "visible"
        || current.status !== "RUNNING"
        || current.status !== "RUNNING"
        || activityInFlightRef.current) return;

      activityInFlightRef.current = true;
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/activity`, { method: "POST" });
        if (!response.ok) await refreshRuntime();
      } catch {
        // The next heartbeat or status poll will retry after transient failures.
      } finally {
        activityInFlightRef.current = false;
      }
    };

    const resume = () => {
      lastTickAt = Date.now();
      if (document.visibilityState === "visible") {
        void sendActivity();
        void refreshRuntime();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") resume();
    };
    const tick = () => {
      const now = Date.now();
      const drifted = now - lastTickAt > WORKSPACE_RESUME_DRIFT_MS;
      lastTickAt = now;
      if (document.visibilityState !== "visible") return;
      void sendActivity();
      if (drifted) void refreshRuntime();
    };

    void sendActivity();
    const timer = setInterval(tick, WORKSPACE_ACTIVITY_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refreshRuntime, workspaceId]);

  if (STARTUP_STATUSES.has(runtime.status)) {
    const failed = runtime.status === "ERROR";
    return (
      <section className="flex h-full min-h-0 flex-col bg-primary">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-secondary px-3 py-2">
          <h1 className="text-sm font-semibold text-primary">{failed ? "开发环境启动失败" : "正在启动开发环境"}</h1>
          <BadgeWithDot color={statusColor[runtime.status as keyof typeof statusColor] ?? "gray"}>{runtime.status}</BadgeWithDot>
          {runtime.access.leaseValid && <div className="ml-auto flex items-center">
            <Button size="sm" isDisabled={!!workspaceAction} color="secondary" iconLeading={StopCircle} isLoading={workspaceAction === "stop"} onPress={() => void changeWorkspace("stop")}>停止</Button>
          </div>}
        </div>
        {workspaceActionError && <p role="alert" className="shrink-0 border-b border-secondary px-3 py-2 text-sm text-error-primary">{toUserFacingText(workspaceActionError)}</p>}
        {runtime.error && <p role="alert" className="shrink-0 border-b border-secondary px-3 py-2 text-sm text-error-primary">{toUserFacingText(runtime.error)}</p>}
        <LogViewer
          workspaceId={workspaceId}
          channel="startup"
          emptyText="等待开发环境启动输出..."
          className="h-full"
          showControls={false}
          fillAvailable
          flush
        />
      </section>
    );
  }

  if (runtime.status === "STOPPED") {
    return (
      <section className="flex h-full min-h-0 items-center justify-center overflow-hidden bg-primary px-6 py-12">
        <EmptyState size="md">
          <EmptyState.Header pattern="none">
            <EmptyState.FeaturedIcon icon={StopCircle} color="gray" />
          </EmptyState.Header>
          <EmptyState.Content>
            <EmptyState.Title>开发容器已停止</EmptyState.Title>
            <EmptyState.Description>项目源码和当前修改均已保留，重新启动容器后可以继续开发。</EmptyState.Description>
            {workspaceActionError && <p role="alert" className="mt-2 text-sm text-error-primary">{toUserFacingText(workspaceActionError)}</p>}
          </EmptyState.Content>
          <EmptyState.Footer>
            <Button
              iconLeading={PlayCircle}
              isLoading={workspaceAction === "start"}
              isDisabled={!!workspaceAction || !runtime.access.leaseValid}
              onPress={() => void changeWorkspace("start")}
            >
              重新启动容器
            </Button>
          </EmptyState.Footer>
        </EmptyState>
      </section>
    );
  }

  const restartService = async (service: WorkspaceService) => {
    const operationInProgress = service.operation?.status === "PENDING" || service.operation?.status === "RUNNING";
    if (!runtime.access.writable || !service.restartable || operationInProgress || submittingServiceId === service.id) return;
    setSubmittingServiceId(service.id);
    setRestartError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/services/${service.id}/restart`, {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey() },
      });
      const payload = await response.json() as ServiceOperation & { error?: string };
      if (!response.ok && !(response.status === 409 && payload.id)) {
        throw new Error(payload.error || "无法提交服务重启任务。");
      }
      if (payload.id) {
        setRuntime((current) => ({
          ...current,
          services: current.services.map((candidate) => candidate.id === service.id
            ? { ...candidate, operation: payload }
            : candidate),
        }));
      }
    } catch (error) {
      setRestartError({ serviceId: service.id, message: error instanceof Error ? error.message : "无法提交服务重启任务。" });
    } finally {
      setSubmittingServiceId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-primary">
      {(runtime.error || workspaceActionError) && (
        <div className="shrink-0 border-b border-secondary bg-error-primary px-4 py-2 text-sm text-error-primary" role="alert">
          {toUserFacingText(runtime.error || workspaceActionError || "")}
        </div>
      )}
      {realtimeState !== "connected" && runtime.status === "RUNNING" && (
        <div className="shrink-0 border-b border-secondary bg-warning-primary px-4 py-2 text-sm text-warning-primary" role="status">
          实时状态连接正在恢复，Workspace 状态将通过主动检查保持同步。
        </div>
      )}
      {!runtime.access.leaseValid && (
        <div className="shrink-0 border-b border-secondary bg-warning-primary px-4 py-2 text-sm font-medium text-warning-primary" role="status">
          当前项目租约与此工作区不匹配，开发环境已不可写。
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(320px,1fr)_minmax(0,1fr)] overflow-hidden bg-primary lg:grid-cols-[minmax(0,1.45fr)_minmax(380px,1fr)] lg:grid-rows-1 lg:divide-x lg:divide-border-secondary">
        <section className="flex min-h-0 min-w-0 flex-col">
          <TerminalPanel
            workspaceId={workspaceId}
            workspaceStatus={runtime.status}
            workspaceError={runtime.status === "ERROR" && runtime.error ? toUserFacingText(runtime.error) : null}
            writable={runtime.access.writable}
            accessReason={runtime.access.reason}
          />
        </section>
        <section className="flex min-h-0 min-w-0 flex-col border-t border-secondary bg-secondary lg:border-t-0">
          <div className="flex min-h-0 flex-1 flex-col divide-y divide-border-secondary overflow-y-auto">
            {runtime.services.length > 0 ? runtime.services.map((service) => {
              const operationInProgress = service.operation?.status === "PENDING" || service.operation?.status === "RUNNING";
              const isRestarting = operationInProgress || submittingServiceId === service.id;
              const operationColor = service.operation?.status === "FAILED" ? "error" : operationInProgress ? "blue" : service.operation?.status === "SUCCEEDED" ? "success" : "gray";
              const publishedPort = findPublishedServicePort(runtime.ports, service.port);
              const previewUrl = service.browser && runtime.container?.running
                ? service.gatewayUrl ?? (publishedPort?.status === "AVAILABLE" && publishedPort.url
                  ? buildPreviewUrl(publishedPort.url, previewHostname)
                  : null)
                : null;
              return (
                <section key={service.id} className="flex min-h-64 flex-1 flex-col bg-primary">
                  <div className="flex h-12 shrink-0 items-center gap-2 px-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-primary">{service.name}</h3>
                      {service.operation && <BadgeWithDot color={operationColor}>{service.operation.status}</BadgeWithDot>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {service.browser && (previewUrl ? (
                        <Button
                          size="xs"
                          color="tertiary"
                          iconLeading={LinkExternal01}
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          预览
                        </Button>
                      ) : (
                        <Tooltip title="预览地址尚未就绪">
                          <Button size="xs" color="tertiary" iconLeading={LinkExternal01} isDisabled>
                            预览
                          </Button>
                        </Tooltip>
                      ))}
                      {service.restartable && <Button size="xs" color="tertiary" iconLeading={RefreshCcw01} isLoading={isRestarting} isDisabled={!runtime.access.writable} showTextWhileLoading onPress={() => void restartService(service)}>{isRestarting ? "正在重启" : "重启"}</Button>}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    {restartError?.serviceId === service.id && <p role="alert" className="border-b border-secondary px-3 py-2 text-xs text-error-primary">重启失败：{toUserFacingText(restartError.message)}</p>}
                    {service.operation?.status === "FAILED" && service.operation.error && <p role="alert" className="border-b border-secondary px-3 py-2 text-xs text-error-primary">重启失败：{toUserFacingText(service.operation.error)}</p>}
                    <LogViewer workspaceId={workspaceId} channel="service" serviceId={service.id} emptyText={`等待 ${service.name} 输出...`} className="h-full" showControls={false} fillAvailable flush />
                  </div>
                </section>
              );
            }) : <div className="flex flex-1 items-center justify-center bg-primary px-4 py-8 text-center text-sm text-tertiary">项目未声明服务日志源。</div>}
          </div>
        </section>
      </div>

      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-secondary bg-primary px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch01 className="size-4 shrink-0 text-fg-quaternary" />
          {runtime.git ? <>
            <span className="max-w-40 truncate text-xs font-medium text-secondary">{runtime.git.branch}</span>
            <div className="flex shrink-0 items-center gap-1 tabular-nums">
              <Badge size="sm" color="success">A {runtime.git.added}</Badge>
              <Badge size="sm" color="warning">M {runtime.git.modified}</Badge>
              <Badge size="sm" color="error">D {runtime.git.deleted}</Badge>
            </div>
          </> : <span className="text-xs text-quaternary">Git 状态不可用</span>}
        </div>
      </div>
    </div>
  );
}
