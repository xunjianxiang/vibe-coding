import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { readContainerInventory } from "@/lib/container-inventory";
import { buildGatewayPreviewUrl } from "@/lib/preview-url";
import { readWorkspaceGitStatus } from "@/runner/git-status";
import { readWorkspaceServices } from "@/runner/logs";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId, sub: session.sub },
    select: {
      status: true,
      desiredState: true,
      containerId: true,
      containerState: true,
      containerObservedAt: true,
      containerStoppedAt: true,
      containerExitCode: true,
      containerStopReason: true,
      containerOomDetected: true,
      projectId: true,
      path: true,
      activeAt: true,
      expiresAt: true,
      updatedAt: true,
      error: true,
      project: { select: { lease: true } },
      ports: { orderBy: { containerPort: "asc" }, select: { id: true, containerPort: true, hostPort: true, status: true, url: true } },
      codexSessions: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true, error: true } },
      serviceOperations: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, serviceId: true, status: true, error: true },
      },
    },
  });
  if (!workspace) return Response.json({ error: "Not found" }, { status: 404 });
  const [services, inventory, git, runnerHealth] = await Promise.all([
    readWorkspaceServices(workspaceId),
    readContainerInventory(),
    readWorkspaceGitStatus({
      containerId: workspace.containerId,
      workspaceId,
      projectId: workspace.projectId,
      workspacePath: workspace.path,
    }),
    getDb().runnerHealth.findUnique({ where: { id: "local" } }),
  ]);
  const container = inventory.containers.find((candidate) => candidate.id === workspace.containerId);
  const leaseValid = workspace.project.lease?.sub === session.sub
    && workspace.project.lease.workspaceId === workspaceId;
  const developing = workspace.project.lease?.state === "DEVELOPING";
  const conflict = container?.anomaly === "PROJECT_CONFLICT" || container?.anomaly === "OWNERSHIP_CONFLICT";
  const containerRunning = workspace.containerState === "running"
    || (workspace.containerState === null && container?.running === true);
  const writable = leaseValid && developing && workspace.status === "RUNNING" && workspace.desiredState === "RUNNING" && containerRunning && !conflict;
  const accessReason = writable
    ? null
    : !leaseValid
      ? "LEASE_INVALID"
      : conflict
        ? "CONTAINER_CONFLICT"
        : !containerRunning
          ? "CONTAINER_NOT_RUNNING"
          : "WORKSPACE_NOT_RUNNING";
  return Response.json({
    status: workspace.status,
    desiredState: workspace.desiredState,
    error: workspace.error,
    activeAt: workspace.activeAt,
    expiresAt: workspace.expiresAt,
    updatedAt: workspace.updatedAt,
    container: workspace.containerId ? {
      id: workspace.containerId,
      state: workspace.containerState ?? container?.state ?? "unknown",
      running: containerRunning,
      anomaly: container?.anomaly ?? null,
      observedAt: workspace.containerObservedAt,
      stoppedAt: workspace.containerStoppedAt,
      exitCode: workspace.containerExitCode,
      stopReason: workspace.containerStopReason,
      oomDetected: workspace.containerOomDetected,
    } : null,
    runner: runnerHealth ? {
      dockerStatus: runnerHealth.dockerStatus,
      eventStreamConnected: runnerHealth.eventStreamConnected,
      checkedAt: runnerHealth.checkedAt,
    } : null,
    access: { leaseValid, writable, reason: accessReason },
    ports: workspace.ports,
    codex: workspace.codexSessions[0] ?? null,
    git,
    services: services.map(({ id, name, port, browser, command }) => ({
      id,
      name,
      port: port ?? null,
      browser: browser === true,
      gatewayUrl: browser === true && port ? buildGatewayPreviewUrl(workspaceId, port) : null,
      restartable: !!command,
      operation: workspace.serviceOperations.find((operation) => operation.serviceId === id) ?? null,
    })),
  });
}
