"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, PlayCircle, Plus, RefreshCcw01, SearchLg, StopCircle, Trash01, XClose } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { ProjectReleaseDialog } from "@/components/project-release-dialog";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { UserIdentity } from "@/components/user-identity";
import { toUserFacingText } from "@/lib/ui-copy";
import type { UserIdentity as UserIdentityData } from "@/lib/user-identity";

type ContainerState = {
  state: string;
  running: boolean;
  anomaly: "ORPHAN" | "PROJECT_CONFLICT" | "OWNERSHIP_CONFLICT" | null;
};

export type ProjectRow = {
  id: string;
  key: string;
  status: "DISCOVERING" | "READY" | "INVALID" | "MISSING";
  error: string | null;
  lease: null | {
    sub: string;
    state: "CLAIMED" | "DEVELOPING";
    workspaceId: string | null;
    user: UserIdentityData;
  };
  workspace: null | {
    id: string;
    sub: string;
    status: string;
    error: string | null;
  };
  container: ContainerState | null;
};

const statusColor = { READY: "success", DISCOVERING: "blue", INVALID: "error", MISSING: "warning" } as const;
const statusLabel = { READY: "可用", DISCOVERING: "检查中", INVALID: "无效", MISSING: "目录缺失" } as const;
type ProjectFilter = "all" | "mine" | "available" | "issues";
type ReleaseTarget = { projectId: string; projectKey: string; workspaceId: string | null };

const projectFilters: Array<{ id: ProjectFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "mine", label: "我的" },
  { id: "available", label: "空闲" },
  { id: "issues", label: "异常" },
];

const errorMessages: Record<string, string> = {
  LEASE_CONFLICT: "项目已被其他用户领取。",
  LEASE_CLEANUP_PENDING: "旧开发环境正在释放，请稍后重试。",
  WORKSPACE_CONFLICT: "项目已有活动 Workspace，无法重复创建。",
  PROJECT_NOT_READY: "项目尚未通过配置校验。",
  LEASE_NOT_RELEASABLE: "当前租约不能释放。",
  CONTAINER_CONFLICT: "项目容器存在冲突，需等待 Runner 清理后再试。",
};

function environmentLabel(workspaceStatus: string | undefined, container: ContainerState | null) {
  if (container?.anomaly === "PROJECT_CONFLICT") return { label: "容器冲突", color: "error" as const };
  if (container?.anomaly === "OWNERSHIP_CONFLICT") return { label: "归属冲突", color: "error" as const };
  if (container?.anomaly === "ORPHAN") return { label: "孤儿容器", color: "warning" as const };
  if (container?.running) return { label: "运行中", color: "success" as const };
  if (!workspaceStatus) return { label: "未启动", color: "gray" as const };
  return { label: workspaceLabel(workspaceStatus), color: workspaceColor(workspaceStatus) };
}

function workspaceLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "等待启动",
    CREATING: "创建中",
    STARTING: "启动中",
    RUNNING: "运行中",
    STOPPING: "停止中",
    STOPPED: "已停止",
    DELETING: "释放中",
    DELETED: "已释放",
    ERROR: "异常",
  };
  return labels[status] ?? status;
}

function workspaceColor(status: string) {
  if (status === "RUNNING") return "success" as const;
  if (status === "ERROR") return "error" as const;
  if (status === "STOPPING" || status === "DELETING") return "warning" as const;
  if (status === "STOPPED" || status === "DELETED") return "gray" as const;
  return "blue" as const;
}

export function ProjectTable({
  projects,
  currentSub,
}: {
  projects: ProjectRow[];
  currentSub: string;
}) {
  const router = useRouter();
  const { subscribe } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null);
  const [stoppingWorkspaceIds, setStoppingWorkspaceIds] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const activeStoppingWorkspaceIds = stoppingWorkspaceIds.filter((workspaceId) => projects.some((project) =>
    project.workspace?.id === workspaceId
    && project.workspace.status !== "STOPPED"
    && project.workspace.status !== "ERROR"
    && project.workspace.status !== "DELETED"
  ));
  const hasWorkspaceTransition = projects.some((project) =>
    project.workspace?.status === "STOPPING" || project.workspace?.status === "DELETING"
  ) || activeStoppingWorkspaceIds.length > 0;

  useEffect(() => subscribe((message) => {
    if (message.type !== "workspace.status.changed") return;
    if (message.scope?.projectId && !projects.some((project) => project.id === message.scope?.projectId)) return;
    if (message.scope?.workspaceId && message.data.status !== "STOPPING") {
      setStoppingWorkspaceIds((current) => current.filter((workspaceId) => workspaceId !== message.scope?.workspaceId));
    }
    router.refresh();
  }), [projects, router, subscribe]);

  useEffect(() => {
    if (!hasWorkspaceTransition) return;
    const refresh = () => router.refresh();
    const timer = window.setInterval(refresh, 2_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasWorkspaceTransition, router]);
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return projects.filter((project) => {
      const mine = project.lease?.sub === currentSub;
      const available = !project.lease && !project.workspace && project.status === "READY";
      const hasIssue = project.status === "INVALID"
        || project.status === "MISSING"
        || project.workspace?.status === "ERROR"
        || project.container?.anomaly != null;
      const matchesFilter = filter === "all"
        || (filter === "mine" && mine)
        || (filter === "available" && available)
        || (filter === "issues" && hasIssue);
      const matchesQuery = !normalizedQuery || [project.key, project.error, project.workspace?.error, project.lease?.sub]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));

      return matchesFilter && matchesQuery;
    });
  }, [currentSub, filter, projects, query]);

  const showError = (code?: string) => setError(code ? errorMessages[code] ?? "操作失败，请刷新后重试。" : "操作失败，请刷新后重试。");

  const scanProjects = () => {
    setError(null);
    setScanning(true);
    startTransition(async () => {
      try {
        const response = await fetch("/api/reconcile", { method: "POST" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          showError(payload?.error);
          return;
        }
        router.refresh();
      } catch {
        showError();
      } finally {
        setScanning(false);
      }
    });
  };

  const mutate = (projectId: string, request: () => Promise<Response>) => {
    setError(null);
    setActiveProjectId(projectId);
    startTransition(async () => {
      try {
        const response = await request();
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          showError(payload?.error);
          return;
        }
        window.location.reload();
      } catch {
        showError();
      } finally {
        setActiveProjectId(null);
      }
    });
  };

  const startWorkspace = (projectId: string) => {
    setError(null);
    setActiveProjectId(projectId);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/workspaces`, {
          method: "POST",
          headers: { "Idempotency-Key": createIdempotencyKey() },
        });
        const payload = (await response.json().catch(() => null)) as { workspaceId?: string; error?: string } | null;
        if (!response.ok || !payload?.workspaceId) {
          showError(payload?.error);
          return;
        }
        router.push(`/workspaces/${payload.workspaceId}`);
      } catch {
        showError();
      } finally {
        setActiveProjectId(null);
      }
    });
  };

  const stopWorkspace = (projectId: string, workspaceId: string) => {
    setError(null);
    setActiveProjectId(projectId);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/stop`, { method: "POST" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          showError(payload?.error);
          return;
        }
        setStoppingWorkspaceIds((current) => current.includes(workspaceId) ? current : [...current, workspaceId]);
      } catch {
        showError();
      } finally {
        setActiveProjectId(null);
      }
    });
  };

  const releaseProject = () => {
    if (!releaseTarget) return;
    const { projectId, workspaceId } = releaseTarget;
    setError(null);
    setActiveProjectId(projectId);
    startTransition(async () => {
      try {
        const response = await fetch(
          workspaceId ? `/api/workspaces/${workspaceId}` : `/api/projects/${projectId}/lease`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          showError(payload?.error);
          setReleaseTarget(null);
          return;
        }
        setReleaseTarget(null);
        window.location.reload();
      } catch {
        showError();
        setReleaseTarget(null);
      } finally {
        setActiveProjectId(null);
      }
    });
  };

  return (
    <TableCard.Root aria-busy={pending}>
      <TableCard.Header
        title="项目列表"
        badge={`${projects.length}`}
      />
      {projects.length > 0 && <div className="flex flex-col gap-3 border-b border-secondary bg-primary px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
        <label className="group relative block w-full md:max-w-xs">
          <span className="sr-only">搜索项目</span>
          <SearchLg className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-quaternary transition-colors group-focus-within:text-fg-brand-primary" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目"
            className="h-11 w-full rounded-lg bg-primary py-2 pr-11 pl-10 text-sm text-primary shadow-xs ring-1 ring-primary outline-none transition placeholder:text-placeholder focus:ring-2 focus:ring-brand"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清空搜索"
              className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-r-lg text-fg-quaternary outline-focus-ring transition hover:bg-primary_hover hover:text-fg-quaternary_hover focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <XClose className="size-4" />
            </button>
          )}
        </label>

        <div className="flex items-center justify-between gap-3 overflow-x-auto">
          <Button size="sm" color="secondary" iconLeading={RefreshCcw01} isLoading={scanning} isDisabled={scanning} onPress={scanProjects}>刷新状态</Button>
          <div className="flex shrink-0 rounded-lg bg-secondary p-1" role="group" aria-label="筛选项目">
            {projectFilters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={`min-h-10 min-w-14 rounded-md px-3 py-2 text-sm font-semibold outline-focus-ring transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  filter === option.id
                    ? "bg-primary text-secondary shadow-xs ring-1 ring-secondary"
                    : "text-tertiary hover:text-tertiary_hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>}
      {error && <div role="alert" className="border-b border-error_subtle bg-error-primary px-5 py-3 text-sm text-error-primary">{error}</div>}
      {projects.length === 0 ? (
        <div className="px-6 py-12 text-center"><p className="text-sm font-medium text-primary">尚未发现项目</p><p className="mt-1 text-sm text-tertiary">等待 Runner 扫描受控项目目录。</p></div>
      ) : filteredProjects.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-primary">没有匹配的项目</p>
          <p className="mt-1 text-sm text-tertiary">调整搜索内容或切换筛选条件。</p>
          <Button className="mt-4" size="sm" color="secondary" onPress={() => { setQuery(""); setFilter("all"); }}>清除筛选</Button>
        </div>
      ) : <Table aria-label="开发任务列表" size="sm">
        <Table.Header>
          <Table.Head id="project" isRowHeader label="项目" />
          <Table.Head id="validation" label="校验" />
          <Table.Head id="lease" label="领取状态" />
          <Table.Head id="workspace" label="开发环境" />
          <Table.Head id="actions" label="操作" />
        </Table.Header>
        <Table.Body>
          {filteredProjects.map((project) => {
            const mine = project.lease?.sub === currentSub;
            const conflict = project.container?.anomaly === "PROJECT_CONFLICT" || project.container?.anomaly === "OWNERSHIP_CONFLICT";
            const workspaceId = project.lease?.workspaceId;
            const stoppingOptimistically = !!workspaceId && activeStoppingWorkspaceIds.includes(workspaceId);
            const workspaceStatus = stoppingOptimistically ? "STOPPING" : project.workspace?.status;
            const environment = environmentLabel(workspaceStatus, project.container);
            const canEnter = mine && !!workspaceId && workspaceStatus === "RUNNING" && project.container?.running === true && !conflict;
            const stopped = workspaceStatus === "STOPPED";
            const stopping = workspaceStatus === "STOPPING";
            const deleting = workspaceStatus === "DELETING";
            const canClaim = !conflict && !project.lease && !project.workspace && project.status === "READY";
            const canStart = !conflict && mine && project.lease?.state === "CLAIMED" && (!workspaceId || (stopped && !canEnter));
            const canStop = !conflict && mine && project.lease?.state === "DEVELOPING" && !!workspaceId && workspaceStatus === "RUNNING" && !canEnter && !deleting;
            const hasAction = canClaim || canStart || (canEnter && !deleting) || canStop;
            const unavailableLabel = conflict
                ? "等待处理"
                : deleting
                  ? "释放中"
                  : project.lease && !mine
                    ? "他人占用"
                    : project.status !== "READY"
                      ? statusLabel[project.status]
                      : workspaceStatus
                        ? workspaceLabel(workspaceStatus)
                        : "暂不可用";
            return (
              <Table.Row key={project.id} id={project.id}>
                <Table.Cell>
                  <div className="min-w-44 max-w-72"><p className="font-medium text-primary">{project.key}</p><p className="mt-0.5 truncate text-xs text-quaternary">{toUserFacingText(project.error ?? project.workspace?.error ?? "开发环境配置已通过静态校验")}</p></div>
                </Table.Cell>
                <Table.Cell><BadgeWithDot color={statusColor[project.status]}>{statusLabel[project.status]}</BadgeWithDot></Table.Cell>
                <Table.Cell>
                  {project.lease ? (
                    <UserIdentity
                      user={project.lease.user}
                      isCurrentUser={mine}
                      className="min-w-44 max-w-64"
                    />
                  ) : <span className="text-sm text-tertiary">空闲</span>}
                </Table.Cell>
                <Table.Cell>
                  <BadgeWithDot color={environment.color}>{environment.label}</BadgeWithDot>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex min-w-40 items-center justify-end gap-2">
                    {canClaim && <Button isDisabled={pending} isLoading={pending && activeProjectId === project.id} iconLeading={Plus} onPress={() => mutate(project.id, () => fetch(`/api/projects/${project.id}/lease`, { method: "POST" }))}>领取</Button>}
                    {canStart && <>
                      <Button isDisabled={pending} isLoading={pending && activeProjectId === project.id} iconLeading={PlayCircle} onPress={() => startWorkspace(project.id)}>启动</Button>
                      <Dropdown.Root>
                        <Dropdown.DotsButton className="flex size-10 items-center justify-center" aria-label={`${project.key} 的更多操作`} isDisabled={pending} />
                        <Dropdown.Popover className="w-40">
                          <Dropdown.Menu>
                            <Dropdown.Item icon={workspaceId ? Trash01 : XClose} onAction={() => setReleaseTarget({ projectId: project.id, projectKey: project.key, workspaceId: workspaceId ?? null })}>释放</Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </>}
                    {canEnter && !deleting && <>
                      <Button href={`/workspaces/${workspaceId}`} iconTrailing={ArrowRight}>进入工作台</Button>
                      <Dropdown.Root>
                        <Dropdown.DotsButton className="flex size-10 items-center justify-center" aria-label={`${project.key} 的更多操作`} isDisabled={pending || stopping} />
                        <Dropdown.Popover className="w-40">
                          <Dropdown.Menu>
                            <Dropdown.Item icon={StopCircle} onAction={() => stopWorkspace(project.id, workspaceId)}>停止</Dropdown.Item>
                            <Dropdown.Item icon={Trash01} onAction={() => setReleaseTarget({ projectId: project.id, projectKey: project.key, workspaceId: workspaceId ?? null })}>释放</Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </>}
                    {canStop && <>
                      <Button isDisabled={pending || stopping} isLoading={pending && activeProjectId === project.id} color="tertiary" iconLeading={StopCircle} onPress={() => stopWorkspace(project.id, workspaceId)}>{stopping ? "停止中" : "停止"}</Button>
                      <Dropdown.Root>
                        <Dropdown.DotsButton className="flex size-10 items-center justify-center" aria-label={`${project.key} 的更多操作`} isDisabled={pending || stopping} />
                        <Dropdown.Popover className="w-40">
                          <Dropdown.Menu>
                            <Dropdown.Item icon={Trash01} onAction={() => setReleaseTarget({ projectId: project.id, projectKey: project.key, workspaceId: workspaceId ?? null })}>释放</Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </>}
                    {!hasAction && <span className="text-xs font-medium text-quaternary">{unavailableLabel}</span>}
                  </div>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>}
      <ProjectReleaseDialog
        isOpen={releaseTarget !== null}
        isReleasing={pending && activeProjectId === releaseTarget?.projectId}
        projectKey={releaseTarget?.projectKey ?? "项目"}
        hasWorkspace={releaseTarget?.workspaceId != null}
        onCancel={() => setReleaseTarget(null)}
        onConfirm={releaseProject}
      />
    </TableCard.Root>
  );
}
