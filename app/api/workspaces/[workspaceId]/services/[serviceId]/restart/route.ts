import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { projectHasContainerConflict, readContainerInventory } from "@/lib/container-inventory";
import { getRequestOrigin } from "@/lib/http/origin";
import { readWorkspaceServices } from "@/runner/logs";

function isUniqueConflict(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2002";
}

export async function POST(request: Request, context: { params: Promise<unknown> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) return Response.json({ error: "invalid_origin" }, { status: 403 });

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }

  const params = await context.params;
  if (!params || typeof params !== "object"
    || !("workspaceId" in params) || typeof params.workspaceId !== "string"
    || !("serviceId" in params) || typeof params.serviceId !== "string") {
    return Response.json({ error: "invalid_route_parameters" }, { status: 400 });
  }
  const { workspaceId, serviceId } = params;
  const db = getDb();
  const workspace = await db.workspace.findFirst({
    where: {
      id: workspaceId,
      sub: session.sub,
      status: "RUNNING",
      containerId: { not: null },
      project: { lease: { is: { sub: session.sub, workspaceId, state: "DEVELOPING" } } },
    },
    select: { id: true, projectId: true, containerId: true },
  });
  if (!workspace) return Response.json({ error: "workspace_not_running" }, { status: 409 });
  const inventory = await readContainerInventory(db);
  const container = inventory.containers.find((candidate) => candidate.id === workspace.containerId);
  if (!container?.running || container.projectId !== workspace.projectId || container.workspaceId !== workspaceId) {
    return Response.json({ error: "container_not_available" }, { status: 409 });
  }
  if (projectHasContainerConflict(inventory, workspace.projectId)) {
    return Response.json({ error: "container_conflict" }, { status: 409 });
  }

  const service = (await readWorkspaceServices(workspaceId)).find((candidate) => candidate.id === serviceId);
  if (!service) return Response.json({ error: "service_not_found" }, { status: 404 });
  if (!service.command) return Response.json({ error: "service_not_restartable" }, { status: 409 });

  try {
    const operation = await db.serviceOperation.create({
      data: {
        workspaceId,
        serviceId,
        action: "RESTART",
        requestedBy: session.sub,
        idempotencyKey,
        activeKey: serviceId,
      },
      select: { id: true, status: true },
    });
    return Response.json(operation, { status: 202 });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await db.serviceOperation.findFirst({
        where: {
          workspaceId,
          OR: [{ idempotencyKey }, { activeKey: serviceId }],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      return Response.json(existing ?? { error: "service_operation_conflict" }, { status: existing?.status === "PENDING" || existing?.status === "RUNNING" ? 409 : 200 });
    }
    throw error;
  }
}
