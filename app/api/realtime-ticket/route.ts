import { readSession } from "@/lib/auth/session";
import { getRequestOrigin } from "@/lib/http/origin";
import { signRealtimeTicket } from "@/lib/realtime-ticket";

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });

  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  return Response.json({
    ticket: signRealtimeTicket({ sub: session.sub, sessionId: session.id, exp: expiresAt }),
    expiresAt,
  });
}
