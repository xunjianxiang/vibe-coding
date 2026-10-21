import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { readContainerInventory } from "@/lib/container-inventory";
import { getRequestOrigin } from "@/lib/http/origin";
import { cleanupOrphanContainer } from "@/lib/runner-client";

export async function POST(request: Request, { params }: { params: Promise<{ containerId: string }> }) {
  const session = await readSession();
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const origin = request.headers.get("origin");
  if (!origin || origin !== await getRequestOrigin()) {
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }

  const { containerId } = await params;
  const inventory = await readContainerInventory(getDb());
  const container = inventory.containers.find((candidate) => candidate.id === containerId);
  if (!container) return Response.json({ error: "CONTAINER_NOT_FOUND" }, { status: 404 });
  if (container.anomaly !== "ORPHAN") {
    return Response.json({ error: "CONTAINER_NOT_ORPHANED" }, { status: 409 });
  }

  const result = await cleanupOrphanContainer(containerId);
  if (result.ok) return new Response(null, { status: 204 });
  return Response.json({ error: result.error }, { status: result.status });
}
