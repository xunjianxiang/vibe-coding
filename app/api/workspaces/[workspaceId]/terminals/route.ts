import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getRequestOrigin } from "@/lib/http/origin";
import type { TerminalAgent, TerminalKind } from "@/lib/terminal-ticket";

const MAX_OPEN_TERMINALS = 8;

function serializeTerminal(terminal: {
  id: string;
  kind: "SHELL" | "AGENT";
  agent: "CODEX" | null;
}) {
  return {
    id: terminal.id,
    title: terminal.kind === "SHELL" ? "临时终端" : "Codex",
    kind: terminal.kind.toLowerCase() as TerminalKind,
    ...(terminal.agent ? { agent: terminal.agent.toLowerCase() as TerminalAgent } : {}),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { workspaceId } = await params;
  const db = getDb();
  const [terminals, workspace] = await Promise.all([
    db.terminal.findMany({
      where: { workspaceId, sub: session.sub, desiredState: "OPEN" },
      orderBy: { sequence: "asc" },
      select: { id: true, kind: true, agent: true },
    }),
    db.workspace.findFirst({
      where: { id: workspaceId, sub: session.sub },
      select: { activeTerminalId: true },
    }),
  ]);
  const openTerminalIds = new Set(terminals.map((terminal) => terminal.id));
  const activeTerminalId = workspace?.activeTerminalId && openTerminalIds.has(workspace.activeTerminalId)
    ? workspace.activeTerminalId
    : null;
  return Response.json({ terminals: terminals.map(serializeTerminal), activeTerminalId });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const { workspaceId } = await params;
  const body = await request.json().catch(() => null) as { terminalId?: unknown } | null;
  if (typeof body?.terminalId !== "string") return Response.json({ error: "INVALID_TERMINAL_ID" }, { status: 400 });

  const db = getDb();
  const terminal = await db.terminal.findFirst({
    where: {
      id: body.terminalId,
      workspaceId,
      sub: session.sub,
      desiredState: "OPEN",
      workspace: {
        sub: session.sub,
        status: "RUNNING",
        desiredState: "RUNNING",
        project: { lease: { is: { sub: session.sub, workspaceId, state: "DEVELOPING" } } },
      },
    },
    select: { id: true },
  });
  if (!terminal) return Response.json({ error: "TERMINAL_NOT_FOUND" }, { status: 404 });

  const updated = await db.workspace.updateMany({
    where: { id: workspaceId, sub: session.sub, status: "RUNNING", desiredState: "RUNNING" },
    data: { activeTerminalId: terminal.id },
  });
  if (updated.count !== 1) return Response.json({ error: "WORKSPACE_NOT_RUNNING" }, { status: 409 });
  return Response.json({ activeTerminalId: terminal.id });
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { workspaceId } = await params;
  const body = await request.json().catch(() => null) as { kind?: unknown; agent?: unknown } | null;
  const kind = body?.kind as TerminalKind | undefined;
  const agent = body?.agent as TerminalAgent | undefined;
  if ((kind !== "shell" && kind !== "agent")
    || (kind === "agent" && agent !== "codex")
    || (kind === "shell" && agent !== undefined)) {
    return Response.json({ error: "INVALID_TERMINAL_CONFIGURATION" }, { status: 400 });
  }

  const db = getDb();
  try {
    const terminal = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const workspace = await tx.workspace.findFirst({
        where: {
          id: workspaceId,
          sub: session.sub,
          status: "RUNNING",
          desiredState: "RUNNING",
          project: { lease: { is: { sub: session.sub, workspaceId, state: "DEVELOPING" } } },
        },
        select: { id: true },
      });
      if (!workspace) throw new Error("WORKSPACE_NOT_RUNNING");
      const openCount = await tx.terminal.count({ where: { workspaceId, desiredState: "OPEN" } });
      if (openCount >= MAX_OPEN_TERMINALS) throw new Error("TERMINAL_LIMIT_REACHED");
      const latest = await tx.terminal.findFirst({
        where: { workspaceId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (latest?.sequence ?? 0) + 1;
      const terminal = await tx.terminal.create({
        data: {
          workspaceId,
          sub: session.sub,
          kind: kind === "shell" ? "SHELL" : "AGENT",
          agent: agent === "codex" ? "CODEX" : null,
          title: kind === "shell" ? "临时终端" : "Codex",
          sequence,
        },
        select: { id: true, kind: true, agent: true },
      });
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { activeTerminalId: terminal.id },
      });
      return terminal;
    });
    return Response.json({ terminal: serializeTerminal(terminal) }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "TERMINAL_CREATE_FAILED";
    return Response.json({ error: code }, { status: code === "TERMINAL_LIMIT_REACHED" ? 409 : 400 });
  }
}
