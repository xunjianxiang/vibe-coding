import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getRequestOrigin } from "@/lib/http/origin";

export async function DELETE(request: Request, { params }: { params: Promise<{ terminalId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const { terminalId } = await params;
  const db = getDb();
  const existing = await db.terminal.findFirst({
    where: { id: terminalId, sub: session.sub },
    select: { id: true, workspaceId: true },
  });
  if (!existing) return Response.json({ error: "TERMINAL_NOT_FOUND" }, { status: 404 });
  await db.$transaction([
    db.terminal.updateMany({
      where: { id: terminalId, sub: session.sub, desiredState: "OPEN" },
      data: { desiredState: "CLOSED", closedAt: new Date() },
    }),
    db.workspace.updateMany({
      where: { id: existing.workspaceId, sub: session.sub, activeTerminalId: terminalId },
      data: { activeTerminalId: null },
    }),
  ]);
  return Response.json({ status: "CLOSED" });
}
