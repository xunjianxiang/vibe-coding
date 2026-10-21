import { randomBytes, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import { projectHasContainerConflict, readContainerInventory } from "@/lib/container-inventory";
import { ACTIVE_WORKSPACE_STATUSES, publicError } from "@/lib/workspace-policy";

type Context = { params: Promise<unknown> };

async function getProjectId(context: Context) {
  const params = await context.params;
  if (!params || typeof params !== "object" || !("projectId" in params) || typeof params.projectId !== "string") {
    throw new Error("INVALID_PROJECT_ID");
  }
  return params.projectId;
}

export async function POST(_request: NextRequest, context: Context) {
  const session = await readSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const projectId = await getProjectId(context);
  const db = getDb();
  if (projectHasContainerConflict(await readContainerInventory(db), projectId)) {
    return Response.json({ error: "CONTAINER_CONFLICT" }, { status: 409 });
  }

  try {
    const lease = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project || project.status !== "READY") throw new Error("PROJECT_NOT_READY");

      const existing = await tx.lease.findUnique({ where: { projectId } });
      if (existing) {
        if (existing.sub === session.sub && existing.state === "CLAIMED" && !existing.workspaceId) return existing;
        throw new Error("LEASE_CONFLICT");
      }

      const activeWorkspace = await tx.workspace.findFirst({
        where: { projectId, status: { in: [...ACTIVE_WORKSPACE_STATUSES] } },
        select: { id: true },
      });
      if (activeWorkspace) throw new Error("WORKSPACE_CONFLICT");
      const rawToken = randomBytes(32).toString("base64url");
      return tx.lease.create({
        data: {
          projectId,
          sub: session.sub,
          state: "CLAIMED",
          tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        },
      });
    });
    return Response.json({ lease }, { status: 201 });
  } catch (error) {
    const message = publicError(error, "LEASE_FAILED");
    const conflict = ["LEASE_CONFLICT", "LEASE_CLEANUP_PENDING", "WORKSPACE_CONFLICT", "CONTAINER_CONFLICT"].includes(message);
    return Response.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  const session = await readSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const projectId = await getProjectId(context);
  const deleted = await getDb().lease.deleteMany({ where: { projectId, sub: session.sub, state: "CLAIMED", workspaceId: null } });
  return deleted.count ? new Response(null, { status: 204 }) : Response.json({ error: "LEASE_NOT_RELEASABLE" }, { status: 409 });
}
