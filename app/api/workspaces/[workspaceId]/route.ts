import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getRequestOrigin } from "@/lib/http/origin";

export async function DELETE(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const { workspaceId } = await params;
  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return "WORKSPACE_NOT_FOUND" as const;
    if (workspace.sub !== session.sub) return "WORKSPACE_ACCESS_DENIED" as const;
    if (workspace.status === "DELETED" || workspace.desiredState === "DELETED") return "ACCEPTED" as const;
    await tx.$queryRaw`SELECT project_id FROM leases WHERE project_id = ${workspace.projectId} FOR UPDATE`;
    const lease = await tx.lease.findUnique({ where: { projectId: workspace.projectId } });
    if (lease?.sub !== session.sub || lease.workspaceId !== workspaceId) return "WORKSPACE_ACCESS_DENIED" as const;
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { desiredState: "DELETED", status: "DELETING", version: { increment: 1 } },
    });
    return "ACCEPTED" as const;
  });

  if (result !== "ACCEPTED") {
    return Response.json({ error: result }, { status: result === "WORKSPACE_NOT_FOUND" ? 404 : 403 });
  }
  return Response.json({ status: "DELETING" }, { status: 202 });
}
