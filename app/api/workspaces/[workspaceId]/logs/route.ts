import { readFile } from "node:fs/promises";
import { readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isServiceId, workspaceLogPath, type WorkspaceLogChannel } from "@/runner/logs";

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
  const logPath = workspaceLogPath(workspaceId, channel, serviceId);

  const encoder = new TextEncoder();
  const requestedOffset = Number(request.headers.get("last-event-id") ?? searchParams.get("offset") ?? 0);
  let sent = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  let initialized = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const publish = async () => {
        try {
          const content = await readFile(logPath, "utf8");
          const lines = content.split(/\r?\n/).filter(Boolean);
          if (lines.length < sent) sent = 0;
          if (!initialized && sent === 0 && lines.length > 200) sent = lines.length - 200;
          for (let index = sent; index < lines.length; index += 1) {
            controller.enqueue(encoder.encode(`id: ${index + 1}\ndata: ${lines[index]}\n\n`));
          }
          sent = lines.length;
          initialized = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "Unable to read logs." })}\n\n`));
          }
        }
      };
      void publish();
      timer = setInterval(() => void publish(), 1_000);
      request.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* Client already disconnected. */ }
      }, { once: true });
    },
    cancel() { if (timer) clearInterval(timer); },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
