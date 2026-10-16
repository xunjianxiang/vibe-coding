import "server-only";
import { request, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { RUNNER_SOCKET_PATH } from "@/lib/runner-socket";
import type { WorkspaceLogChannel } from "@/runner/logs";

export type RunnerCleanupResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 503; error: string };

export function cleanupOrphanContainer(containerId: string): Promise<RunnerCleanupResult> {
  return new Promise((resolve) => {
    const clientRequest = request({
      socketPath: RUNNER_SOCKET_PATH,
      path: `/internal/containers/${encodeURIComponent(containerId)}/cleanup`,
      method: "POST",
      headers: { connection: "close" },
      timeout: 15_000,
    }, (response) => {
      response.resume();
      response.once("end", () => {
        if (response.statusCode === 204) return resolve({ ok: true });
        if (response.statusCode === 404) return resolve({ ok: false, status: 404, error: "CONTAINER_NOT_FOUND" });
        if (response.statusCode === 409) return resolve({ ok: false, status: 409, error: "CONTAINER_NOT_ORPHANED" });
        resolve({ ok: false, status: 503, error: "RUNNER_UNAVAILABLE" });
      });
    });

    clientRequest.once("timeout", () => clientRequest.destroy(new Error("Runner request timed out.")));
    clientRequest.once("error", () => resolve({ ok: false, status: 503, error: "RUNNER_UNAVAILABLE" }));
    clientRequest.end();
  });
}

type WorkspaceLogStreamRequest = {
  workspaceId: string;
  channel: WorkspaceLogChannel;
  serviceId?: string;
  lastEventId?: string;
  signal: AbortSignal;
};

function requestWorkspaceLogStream(input: WorkspaceLogStreamRequest): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const search = new URLSearchParams({ channel: input.channel });
    if (input.serviceId) search.set("serviceId", input.serviceId);
    const headerTimer = setTimeout(() => clientRequest.destroy(new Error("Runner log stream timed out.")), 5_000);
    const clientRequest = request({
      socketPath: RUNNER_SOCKET_PATH,
      path: `/internal/workspaces/${encodeURIComponent(input.workspaceId)}/logs?${search}`,
      method: "GET",
      headers: {
        accept: "text/event-stream",
        ...(input.lastEventId ? { "last-event-id": input.lastEventId } : {}),
      },
    }, (response) => {
      clearTimeout(headerTimer);
      resolve(response);
    });
    const abort = () => clientRequest.destroy(new Error("Log stream request aborted."));
    if (input.signal.aborted) abort();
    else input.signal.addEventListener("abort", abort, { once: true });
    clientRequest.once("response", (response) => {
      response.once("close", () => input.signal.removeEventListener("abort", abort));
    });
    clientRequest.once("error", (error) => {
      clearTimeout(headerTimer);
      input.signal.removeEventListener("abort", abort);
      reject(error);
    });
    clientRequest.end();
  });
}

export async function proxyWorkspaceLogStream(input: WorkspaceLogStreamRequest) {
  let upstream: IncomingMessage;
  try {
    upstream = await requestWorkspaceLogStream(input);
  } catch {
    return new Response("Runner unavailable", { status: 503 });
  }
  if (upstream.statusCode !== 200) {
    upstream.resume();
    return new Response(upstream.statusCode === 400 ? "Invalid log stream selector" : "Runner unavailable", {
      status: upstream.statusCode === 400 ? 400 : 503,
    });
  }
  return new Response(Readable.toWeb(upstream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
