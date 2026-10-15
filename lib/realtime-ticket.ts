import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireEnvironment } from "@/lib/config";

export type RealtimeTicket = {
  sub: string;
  sessionId: string;
  purpose: "realtime";
  jti: string;
  exp: number;
};

function secret() {
  return createHmac("sha256", requireEnvironment("SESSION_ENCRYPTION_KEY")).update("realtime-ticket-signing-key").digest("base64url");
}

export function signRealtimeTicket(input: Omit<RealtimeTicket, "purpose" | "jti">) {
  const payload: RealtimeTicket = { ...input, purpose: "realtime", jti: randomUUID() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyRealtimeTicket(ticket: string): RealtimeTicket | null {
  const [encoded, signature, extra] = ticket.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret()).update(encoded).digest();
  let provided: Buffer;
  try { provided = Buffer.from(signature, "base64url"); } catch { return null; }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RealtimeTicket;
    if (payload.purpose !== "realtime" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub || !/^[a-f0-9]{64}$/.test(payload.sessionId) || !payload.jti) return null;
    return payload;
  } catch {
    return null;
  }
}
