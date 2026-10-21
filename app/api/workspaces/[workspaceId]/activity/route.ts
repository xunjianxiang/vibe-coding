import { readSession } from "@/lib/auth/session";
import { readContainerInventory } from "@/lib/container-inventory";
import { getDb } from "@/lib/db";
import { getRequestOrigin } from "@/lib/http/origin";
import { workspaceIdleDeadline } from "@/lib/workspace-policy";

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });

  const { workspaceId } = await params;
  const db = getDb();
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, sub: session.sub },
    select: {
      id: true,
      projectId: true,
      containerId: true,
      containerState: true,
      status: true,
      expiresAt: true,
      project: { select: { lease: true } },
    },
  });
  if (!workspace) return Response.json({ error: "WORKSPACE_NOT_FOUND" }, { status: 404 });

  const inventory = await readContainerInventory(db);
  const container = inventory.containers.find((candidate) => candidate.id === workspace.containerId) ?? null;
  const leaseValid = workspace.project.lease?.sub === session.sub
    && workspace.project.lease.workspaceId === workspaceId
    && workspace.project.lease.state === "DEVELOPING";
  const inventoryOwnershipValid = !container || (
    container.workspaceId === workspaceId
    && container.projectId === workspace.projectId
    && container.anomaly === null
  );
  const containerAvailable = !!workspace.containerId && workspace.containerState === "running" && inventoryOwnershipValid;

  if (!leaseValid || workspace.status !== "RUNNING" || !containerAvailable) {
    return Response.json({
      error: "WORKSPACE_NOT_RUNNING",
      status: workspace.status,
      expiresAt: workspace.expiresAt,
      container: container ? { id: container.id, state: container.state, running: container.running, anomaly: container.anomaly } : null,
    }, { status: 409 });
  }

  const expiresAt = workspaceIdleDeadline();
  const updated = await db.workspace.updateMany({
    where: {
      id: workspaceId,
      status: "RUNNING",
      containerId: workspace.containerId,
    },
    data: { expiresAt },
  });
  if (updated.count !== 1) {
    return Response.json({ error: "WORKSPACE_NOT_RUNNING" }, { status: 409 });
  }

  return Response.json({
    status: "RUNNING",
    expiresAt,
    container: { id: workspace.containerId, state: workspace.containerState, running: true, anomaly: container?.anomaly ?? null },
  });
}
