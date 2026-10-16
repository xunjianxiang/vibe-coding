import assert from "node:assert/strict";
import { createServer, get, type IncomingMessage } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { pipeWorkspaceLogSse, workspaceLogStreamHub } from "@/runner/log-stream";
import type { WorkspaceLogEntry } from "@/runner/logs";

const selector = { workspaceId: "00000000-0000-0000-0000-000000000002", channel: "startup" as const };

function entry(message: string): WorkspaceLogEntry {
  return {
    timestamp: "2026-10-16T00:00:00.000Z",
    level: "info",
    channel: "startup",
    stream: "stdout",
    message,
  };
}

function readEvents(port: number, count: number, lastEventId?: number, onOpen?: () => void) {
  return new Promise<Array<{ id: number; message: string }>>((resolve, reject) => {
    const request = get({
      host: "127.0.0.1",
      port,
      headers: lastEventId === undefined ? undefined : { "Last-Event-ID": String(lastEventId) },
    });
    request.once("response", (response: IncomingMessage) => {
      assert.match(String(response.headers["content-type"]), /^text\/event-stream/);
      onOpen?.();
      let buffer = "";
      const events: Array<{ id: number; message: string }> = [];
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        buffer += chunk;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const id = /^id: (\d+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!id || !data) continue;
          events.push({ id: Number(id), message: (JSON.parse(data) as WorkspaceLogEntry).message });
          if (events.length === count) {
            response.destroy();
            resolve(events);
            return;
          }
        }
      });
      response.once("error", (error) => {
        if (!response.destroyed) reject(error);
      });
    });
    request.once("error", reject);
  });
}

test("SSE replays buffered logs and streams entries after Last-Event-ID", async () => {
  const first = workspaceLogStreamHub.append(selector, entry("one"));
  const second = workspaceLogStreamHub.append(selector, entry("two"));
  const server = createServer((request, response) => {
    const header = request.headers["last-event-id"];
    pipeWorkspaceLogSse(response, selector, typeof header === "string" ? Number(header) : undefined);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    assert.deepEqual(await readEvents(address.port, 2), [
      { id: first.id, message: "one" },
      { id: second.id, message: "two" },
    ]);
    const resumed = readEvents(address.port, 1, second.id, () => {
      workspaceLogStreamHub.append(selector, entry("three"));
    });
    assert.deepEqual((await resumed).map((item) => item.message), ["three"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});
