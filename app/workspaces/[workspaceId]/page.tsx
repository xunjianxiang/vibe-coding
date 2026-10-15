import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ArrowLeft, CodeBrowser } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { HeaderUser } from "@/components/header-user";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { WorkspaceRuntime } from "@/components/workspace/workspace-runtime";
import { requireUser } from "@/lib/auth/require-user";
import { createServerSso } from "@/lib/auth/sso";
import { getDb } from "@/lib/db";
import { readContainerInventory } from "@/lib/container-inventory";
import { getRequestOrigin } from "@/lib/http/origin";
import { toUserIdentity } from "@/lib/user-identity";
import { readWorkspaceGitStatus } from "@/runner/git-status";
import { readWorkspaceLogSnapshot, readWorkspaceServices } from "@/runner/logs";

async function WorkspaceContent({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await connection();
  const user = await requireUser(`/workspaces/${workspaceId}`);
  const requestOrigin = await getRequestOrigin();
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId, sub: user.sub },
    include: {
      project: { include: { lease: true } },
      ports: { orderBy: { containerPort: "asc" } },
      codexSessions: { orderBy: { startedAt: "desc" }, take: 1 },
      serviceOperations: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, serviceId: true, status: true, error: true },
      },
    },
  });
  if (!workspace) notFound();
  const codex = workspace.codexSessions[0];
  const [startupLogSnapshot, services, inventory, profile, git, runnerHealth] = await Promise.all([
    readWorkspaceLogSnapshot(workspace.id, "startup"),
    readWorkspaceServices(workspace.id),
    readContainerInventory(),
    createServerSso(requestOrigin).users.getCurrent().catch(() => null),
    readWorkspaceGitStatus({
      containerId: workspace.containerId,
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      workspacePath: workspace.path,
    }),
    getDb().runnerHealth.findUnique({ where: { id: "local" } }),
  ]);
  const container = inventory.containers.find((candidate) => candidate.id === workspace.containerId) ?? null;
  const leaseValid = workspace.project.lease?.sub === user.sub
    && workspace.project.lease.workspaceId === workspace.id;
  const developing = workspace.project.lease?.state === "DEVELOPING";
  const conflict = container?.anomaly === "PROJECT_CONFLICT" || container?.anomaly === "OWNERSHIP_CONFLICT";
  const containerRunning = workspace.containerState === "running"
    || (workspace.containerState === null && container?.running === true);
  const writable = leaseValid && developing && workspace.status === "RUNNING" && workspace.desiredState === "RUNNING" && containerRunning && !conflict;
  const accessReason = writable
    ? null
    : !leaseValid
      ? "LEASE_INVALID" as const
      : conflict
        ? "CONTAINER_CONFLICT" as const
        : !containerRunning
          ? "CONTAINER_NOT_RUNNING" as const
          : "WORKSPACE_NOT_RUNNING" as const;
  const currentUser = toUserIdentity(profile, user.sub);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-secondary">
      <header className="shrink-0 border-b border-secondary bg-primary">
        <div className="flex h-15 items-stretch justify-between">
          <div className="flex min-w-0 items-stretch">
            <Tooltip title="返回项目列表" placement="bottom left">
              <Button className="h-full w-15 rounded-none" href="/" size="sm" color="tertiary" iconLeading={<ArrowLeft />} aria-label="返回项目列表" />
            </Tooltip>
            <div className="flex min-w-0 items-center gap-2 px-3">
              <CodeBrowser className="size-5 shrink-0 text-fg-brand-primary" />
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-primary">{workspace.project.key}</p><p className="truncate text-xs text-quaternary">Workspace {workspace.id.slice(0, 8)}</p></div>
            </div>
          </div>
          <HeaderUser user={currentUser} showLogout={false} className="px-3" />
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <WorkspaceRuntime
          workspaceId={workspace.id}
          projectId={workspace.projectId}
          previewHostname={new URL(requestOrigin).hostname}
          initial={{
            status: workspace.status,
            desiredState: workspace.desiredState,
            error: workspace.error,
            activeAt: workspace.activeAt?.toISOString() ?? null,
            expiresAt: workspace.expiresAt?.toISOString() ?? null,
            updatedAt: workspace.updatedAt.toISOString(),
            container: workspace.containerId ? {
              id: workspace.containerId,
              state: workspace.containerState ?? container?.state ?? "unknown",
              running: containerRunning,
              anomaly: container?.anomaly ?? null,
              observedAt: workspace.containerObservedAt?.toISOString() ?? null,
              stoppedAt: workspace.containerStoppedAt?.toISOString() ?? null,
              exitCode: workspace.containerExitCode,
              stopReason: workspace.containerStopReason,
              oomDetected: workspace.containerOomDetected,
            } : null,
            runner: runnerHealth ? {
              dockerStatus: runnerHealth.dockerStatus,
              eventStreamConnected: runnerHealth.eventStreamConnected,
              checkedAt: runnerHealth.checkedAt.toISOString(),
            } : null,
            access: { leaseValid, writable, reason: accessReason },
            ports: workspace.ports.map(({ id, containerPort, hostPort, status, url }) => ({ id, containerPort, hostPort, status, url })),
            codex: codex ? { status: codex.status, error: codex.error } : null,
            git,
            services: services.map(({ id, name, port, browser, command }) => ({
              id,
              name,
              port: port ?? null,
              browser: browser === true,
              restartable: !!command,
              operation: workspace.serviceOperations.find((operation) => operation.serviceId === id) ?? null,
            })),
          }}
          initialStartupLogs={startupLogSnapshot.entries}
          initialStartupLogOffset={startupLogSnapshot.offset}
        />
      </main>
    </div>
  );
}

export default function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return <Suspense fallback={<div className="h-dvh overflow-hidden bg-secondary" />}><WorkspaceContent params={params} /></Suspense>;
}
