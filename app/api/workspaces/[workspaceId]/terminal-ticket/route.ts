import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { projectHasContainerConflict, readContainerInventory } from "@/lib/container-inventory";
import { signTerminalTicket, type TerminalAgent, type TerminalKind } from "@/lib/terminal-ticket";
import { workspaceErrorCode } from "@/lib/workspace-policy";

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const body = await request.json().catch(() => null) as { terminalId?: unknown } | null;
  const terminalId = typeof body?.terminalId === "string" ? body.terminalId : "";
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(terminalId)) {
    return Response.json({ error: "INVALID_TERMINAL_CONFIGURATION" }, { status: 400 });
  }
  const terminal = await getDb().terminal.findFirst({
    where: {
      id: terminalId,
      workspaceId,
      sub: session.sub,
      desiredState: "OPEN",
      workspace: {
        status: "RUNNING",
        desiredState: "RUNNING",
        OR: [
          { error: null },
          { error: { not: { startsWith: workspaceErrorCode.conflict } } },
        ],
        project: { lease: { is: { sub: session.sub, workspaceId, state: "DEVELOPING" } } },
      },
    },
    select: {
      kind: true,
      agent: true,
      workspace: { select: { projectId: true, containerId: true, containerState: true } },
    },
  });
  if (!terminal) return Response.json({ error: "Terminal is not available." }, { status: 409 });
  const workspace = terminal.workspace;
  const inventory = await readContainerInventory();
  const container = inventory.containers.find((candidate) => candidate.id === workspace.containerId);
  const inventoryOwnershipValid = !container || (
    container.projectId === workspace.projectId
    && container.workspaceId === workspaceId
    && container.anomaly === null
  );
  if (workspace.containerState !== "running" || !inventoryOwnershipValid) {
    return Response.json({ error: "CONTAINER_NOT_AVAILABLE" }, { status: 409 });
  }
  if (projectHasContainerConflict(inventory, workspace.projectId)) {
    return Response.json({ error: "CONTAINER_CONFLICT" }, { status: 409 });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const kind = terminal.kind.toLowerCase() as TerminalKind;
  const agent = terminal.agent?.toLowerCase() as TerminalAgent | undefined;
  return Response.json({
    ticket: signTerminalTicket({ sub: session.sub, workspaceId, terminalId, kind, ...(agent ? { agent } : {}), purpose: "terminal", exp: expiresAt }),
    expiresAt,
  });
}
