import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { proxyWorkspaceLogStream } from "@/lib/runner-client";
import { isServiceId, type WorkspaceLogChannel } from "@/runner/logs";

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await readSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { workspaceId } = await params;
  const workspace = await getDb().workspace.findFirst({ where: { id: workspaceId, sub: session.sub }, select: { id: true } });
  if (!workspace) return new Response("Not found", { status: 404 });

  const searchParams = new URL(request.url).searchParams;
  const channel = searchParams.get("channel") as WorkspaceLogChannel | null;
  const serviceId = searchParams.get("serviceId") ?? undefined;
  if (channel !== "startup" && channel !== "service") return new Response("Invalid log channel", { status: 400 });
  if (channel === "service" && (!serviceId || !isServiceId(serviceId))) return new Response("Invalid service ID", { status: 400 });
  return proxyWorkspaceLogStream({
    workspaceId,
    channel,
    serviceId,
    lastEventId: request.headers.get("last-event-id") ?? undefined,
    signal: request.signal,
  });
}
