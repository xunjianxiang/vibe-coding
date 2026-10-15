import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnvironment } from "@/lib/config";

export type TerminalKind = "shell" | "agent";
export type TerminalAgent = "codex";

export type TerminalTicket = {
  sub: string;
  workspaceId: string;
  terminalId: string;
  kind: TerminalKind;
  agent?: TerminalAgent;
  purpose: "terminal";
  exp: number;
};

function secret() {
  return createHmac("sha256", requireEnvironment("SESSION_ENCRYPTION_KEY")).update("terminal-ticket-signing-key").digest("base64url");
}

export function signTerminalTicket(payload: TerminalTicket) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyTerminalTicket(ticket: string): TerminalTicket | null {
  const [encoded, signature, extra] = ticket.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret()).update(encoded).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TerminalTicket;
    if (payload.purpose !== "terminal" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub || !payload.workspaceId || !/^[a-zA-Z0-9-]{1,64}$/.test(payload.terminalId)) return null;
    if (payload.kind !== "shell" && payload.kind !== "agent") return null;
    if (payload.kind === "agent" && payload.agent !== "codex") return null;
    if (payload.kind === "shell" && payload.agent) return null;
    return payload;
  } catch {
    return null;
  }
}
