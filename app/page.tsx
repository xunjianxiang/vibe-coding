import { Suspense } from "react";
import { connection } from "next/server";
import { CodeBrowser } from "@untitledui/icons";
import { ContainerIssues } from "@/components/container-issues";
import { HeaderUser } from "@/components/header-user";
import { ProjectTable, type ProjectRow } from "@/components/project-table";
import { requireUser } from "@/lib/auth/require-user";
import { createServerSso } from "@/lib/auth/sso";
import { getDb } from "@/lib/db";
import { hasContainerIssue } from "@/lib/container-issue";
import { readContainerInventory } from "@/lib/container-inventory";
import { getRequestOrigin } from "@/lib/http/origin";
import { indexSsoUsers, toUserIdentity } from "@/lib/user-identity";
import { ACTIVE_WORKSPACE_STATUSES } from "@/lib/workspace-policy";

async function Dashboard() {
  await connection();
  const session = await requireUser("/");
  const db = getDb();
  const sso = createServerSso(await getRequestOrigin());
  const [projects, profile, ssoUsers, inventory] = await Promise.all([
    db.project.findMany({
      include: {
        lease: true,
        workspaces: { where: { status: { in: [...ACTIVE_WORKSPACE_STATUSES, "STOPPED"] } }, orderBy: { createdAt: "desc" } },
      },
      orderBy: { key: "asc" },
    }),
    sso.users.getCurrent().catch(() => null),
    sso.users.list().catch(() => []),
    readContainerInventory(db),
  ]);
  const ssoUsersBySubject = indexSsoUsers(ssoUsers);
  if (profile) ssoUsersBySubject.set(session.sub, profile);

  const rows: ProjectRow[] = projects.map((project) => {
    const workspace = project.lease?.workspaceId
      ? project.workspaces.find((candidate) => candidate.id === project.lease?.workspaceId)
      : project.workspaces.find((candidate) => candidate.status !== "STOPPED");
    return {
      id: project.id,
      key: project.key,
      status: project.status,
      error: project.error,
      lease: project.lease && {
        sub: project.lease.sub,
        state: project.lease.state,
        workspaceId: project.lease.workspaceId,
        user: toUserIdentity(ssoUsersBySubject.get(project.lease.sub), project.lease.sub),
      },
      workspace: workspace ? {
        id: workspace.id,
        sub: workspace.sub,
        status: workspace.status,
        error: workspace.error,
      } : null,
      container: (() => {
        const container = inventory.containers.find((candidate) => candidate.id === workspace?.containerId)
          ?? inventory.containers.find((candidate) => candidate.projectId === project.id && candidate.running);
        return container ? { state: container.state, running: container.running, anomaly: container.anomaly } : null;
      })(),
    };
  });
  const stats = {
    runningContainers: inventory.containers.filter((container) => container.running).length,
    myClaimedProjects: rows.filter((project) => project.lease?.sub === session.sub).length,
    idleProjects: rows.filter((project) => project.status === "READY" && !project.lease && !project.workspace).length,
    anomalies: rows.filter((project) => project.status === "INVALID"
      || project.status === "MISSING"
      || project.workspace?.status === "ERROR"
      || project.container?.anomaly != null).length
      + inventory.containers.filter((container) => container.anomaly
        && !rows.some((project) => project.id === container.projectId || project.id === container.expectedProjectId)).length,
  };
  const projectKeys = new Map(projects.map((project) => [project.id, project.key]));
  const containerIssues = inventory.containers
    .filter(hasContainerIssue)
    .map((container) => ({
      ...container,
      projectKey: projectKeys.get(container.expectedProjectId ?? container.projectId ?? "") ?? null,
    }))
    .sort((left, right) => {
      const priority = { OWNERSHIP_CONFLICT: 0, PROJECT_CONFLICT: 1, ORPHAN: 2 } as const;
      return (left.anomaly ? priority[left.anomaly] : 3) - (right.anomaly ? priority[right.anomaly] : 3);
    });
  const currentUser = toUserIdentity(profile, session.sub);

  return (
    <div className="min-h-screen bg-secondary">
      <header className="sticky top-0 z-20 border-b border-secondary bg-primary/95 backdrop-blur-sm">
        <div className="flex h-15 w-full items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-solid text-white shadow-xs-skeuomorphic"><CodeBrowser className="size-5" /></span>
            <div><p className="text-sm font-semibold text-primary">Vibe Coding</p><p className="text-xs text-quaternary">开发环境工作台</p></div>
          </div>
          <HeaderUser user={currentUser} showLogout={false} />
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-display-xs font-semibold text-primary">项目</h1>
          <p className="max-w-2xl text-sm text-tertiary">领取项目并进入隔离开发环境，同一项目同一时间仅允许一人修改。</p>
        </div>

        <div className="mb-6 grid grid-cols-2 border-y border-secondary lg:grid-cols-4">
          {[
            { title: "运行中的 Workspace", value: stats.runningContainers, detail: stats.runningContainers > 0 ? "当前运行" : "暂无运行环境" },
            { title: "我的项目", value: stats.myClaimedProjects, detail: "当前领取" },
            { title: "空闲项目", value: stats.idleProjects, detail: "可立即领取" },
            { title: "需要处理", value: stats.anomalies, detail: stats.anomalies > 0 ? "异常或配置问题" : "全部正常" },
          ].map(({ title, value, detail }, index) => (
            <div
              key={title}
              className={`min-w-0 px-3 py-4 lg:px-5 ${
                index % 2 === 1 ? "border-l border-secondary" : ""
              } ${
                index < 2 ? "border-b border-secondary lg:border-b-0" : ""
              } ${
                index > 0 ? "lg:border-l lg:border-secondary" : ""
              }`}
            >
              <p className="text-xs text-quaternary">{title}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className={`text-xl font-semibold tabular-nums ${index === 3 && value > 0 ? "text-error-primary" : "text-primary"}`}>{String(value)}</p>
                <p className="truncate text-xs text-tertiary">{detail}</p>
              </div>
            </div>
          ))}
        </div>

        <ContainerIssues containers={containerIssues} />

        <ProjectTable projects={rows} currentSub={session.sub} />
      </main>
    </div>
  );
}

function DashboardFallback() {
  return (
    <div className="min-h-screen bg-secondary">
      <div className="h-15 border-b border-secondary bg-primary" />
      <main className="w-full px-4 py-8 md:px-8">
        <div className="h-9 w-48 animate-pulse rounded-md bg-tertiary" />
        <div className="mt-3 h-6 w-96 max-w-full animate-pulse rounded-md bg-tertiary" />
        <div className="mt-10 h-72 animate-pulse rounded-xl bg-primary ring-1 ring-secondary" />
      </main>
    </div>
  );
}

export default function Home() {
  return <Suspense fallback={<DashboardFallback />}><Dashboard /></Suspense>;
}
