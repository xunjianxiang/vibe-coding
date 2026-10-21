import { requireUser } from "@/lib/auth/require-user";
import { scanProjectsOnRunner } from "@/lib/runner-client";
import { getRequestOrigin } from "@/lib/http/origin";

export async function POST(request: Request) {
  await requireUser("/");
  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) {
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }
  const result = await scanProjectsOnRunner();
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return new Response(null, { status: 204 });
}
