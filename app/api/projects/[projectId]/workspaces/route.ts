import { getDb } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import type { NextRequest } from "next/server";
import { projectHasContainerConflict, readContainerInventory } from "@/lib/container-inventory";
import { ACTIVE_WORKSPACE_STATUSES, publicError } from "@/lib/workspace-policy";

export async function POST(request: NextRequest, context: { params: Promise<unknown> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const requestId = request.headers.get("idempotency-key")?.trim();
  if (!requestId || requestId.length > 255) return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  const params = await context.params;
  if (!params || typeof params !== "object" || !("projectId" in params) || typeof params.projectId !== "string") {
    return Response.json({ error: "invalid_project_id" }, { status: 400 });
  }
  const projectId = params.projectId;
  const db = getDb();
  if (projectHasContainerConflict(await readContainerInventory(), projectId)) {
    return Response.json({ error: "CONTAINER_CONFLICT" }, { status: 409 });
  }

  try {
    const workspace = await db.$transaction(async (tx) => {
      const existing = await tx.workspace.findUnique({
        where: { projectId_sub_requestId: { projectId, sub: session.sub, requestId } },
      });
      if (existing) return existing;

      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT project_id FROM leases WHERE project_id = ${projectId} FOR UPDATE`;
      const lease = await tx.lease.findUnique({ where: { projectId } });
      const active = await tx.workspace.findFirst({
        where: { projectId, status: { in: [...ACTIVE_WORKSPACE_STATUSES] } },
        orderBy: { createdAt: "desc" },
      });
      if (active && lease?.sub === session.sub && lease.workspaceId === active.id && active.sub === session.sub) {
        return active;
      }
      if (active) throw new Error("WORKSPACE_CONFLICT");
      if (!lease || lease.sub !== session.sub || lease.state !== "CLAIMED") {
        throw new Error("LEASE_CONFLICT");
      }
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project || project.status !== "READY") throw new Error("PROJECT_NOT_READY");

      if (lease.workspaceId) {
        const stopped = await tx.workspace.findFirst({
          where: { id: lease.workspaceId, projectId, sub: session.sub, status: "STOPPED", desiredState: "STOPPED" },
        });
        if (!stopped) throw new Error("WORKSPACE_CONFLICT");
        const resumed = await tx.workspace.update({
          where: { id: stopped.id },
          data: { status: "PENDING", desiredState: "RUNNING", error: null, version: { increment: 1 } },
        });
        await tx.lease.update({
          where: { projectId },
          data: { state: "DEVELOPING" },
        });
        return resumed;
      }

      const created = await tx.workspace.create({
        data: { projectId, sub: session.sub, requestId, path: project.path, status: "PENDING", desiredState: "RUNNING" },
      });
      const updated = await tx.lease.updateMany({
        where: { projectId, sub: session.sub, state: "CLAIMED", workspaceId: null },
        data: {
          state: "DEVELOPING",
          workspaceId: created.id,
        },
      });
      if (updated.count !== 1) throw new Error("LEASE_CONFLICT");
      return created;
    });
    return Response.json({ workspaceId: workspace.id, status: workspace.status }, { status: 202 });
  } catch (error) {
    const message = publicError(error, "WORKSPACE_FAILED");
    return Response.json({ error: message }, { status: ["LEASE_CONFLICT", "WORKSPACE_CONFLICT"].includes(message) ? 409 : 400 });
  }
}
