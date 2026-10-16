import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWorkspaceLogEntry,
  parseLastEventId,
  WorkspaceLogStreamHub,
  WORKSPACE_LOG_MESSAGE_BYTES,
} from "@/runner/log-stream";
import type { WorkspaceLogEntry } from "@/runner/logs";

const selector = { workspaceId: "00000000-0000-0000-0000-000000000001", channel: "startup" as const };

function entry(message: string): WorkspaceLogEntry {
  return {
    timestamp: "2026-10-16T00:00:00.000Z",
    level: "info",
    channel: "startup",
    stream: "stdout",
    message,
  };
}

test("replays recent entries on the first subscription", () => {
  const hub = new WorkspaceLogStreamHub({ maxEntries: 5, replayEntries: 2 });
  hub.append(selector, entry("one"));
  hub.append(selector, entry("two"));
  hub.append(selector, entry("three"));

  const subscription = hub.subscribe(selector, undefined, () => undefined);
  assert.deepEqual(subscription.replay.map((item) => item.entry.message), ["two", "three"]);
  subscription.unsubscribe();
});

test("resumes after Last-Event-ID and falls back when the cursor is outside the buffer", () => {
  const hub = new WorkspaceLogStreamHub({ maxEntries: 3, replayEntries: 2 });
  for (const message of ["one", "two", "three", "four"]) hub.append(selector, entry(message));

  const resumed = hub.subscribe(selector, 2, () => undefined);
  assert.deepEqual(resumed.replay.map((item) => item.entry.message), ["three", "four"]);
  resumed.unsubscribe();

  const expired = hub.subscribe(selector, 0, () => undefined);
  assert.deepEqual(expired.replay.map((item) => item.entry.message), ["three", "four"]);
  expired.unsubscribe();
});

test("pushes appended entries to active subscribers", () => {
  const hub = new WorkspaceLogStreamHub();
  const received: string[] = [];
  const subscription = hub.subscribe(selector, undefined, (item) => received.push(item.entry.message));
  hub.append(selector, entry("live"));
  assert.deepEqual(received, ["live"]);
  subscription.unsubscribe();
});

test("evicts old entries when the byte limit is reached", () => {
  const hub = new WorkspaceLogStreamHub({ maxEntries: 100, maxBytes: 350, replayEntries: 100 });
  hub.append(selector, entry("a".repeat(100)));
  hub.append(selector, entry("b".repeat(100)));
  hub.append(selector, entry("c".repeat(100)));

  const subscription = hub.subscribe(selector, undefined, () => undefined);
  assert.ok(subscription.replay.length < 3);
  assert.equal(subscription.replay.at(-1)?.entry.message, "c".repeat(100));
  subscription.unsubscribe();
});

test("truncates oversized UTF-8 messages", () => {
  const normalized = normalizeWorkspaceLogEntry(entry("\u754c".repeat(WORKSPACE_LOG_MESSAGE_BYTES)));
  assert.ok(Buffer.byteLength(normalized.message, "utf8") <= WORKSPACE_LOG_MESSAGE_BYTES);
  assert.match(normalized.message, /\.\.\. \[truncated\]$/);
  assert.doesNotMatch(normalized.message, /\ufffd/);
});

test("accepts only non-negative safe integer event IDs", () => {
  assert.equal(parseLastEventId("42"), 42);
  assert.equal(parseLastEventId("-1"), undefined);
  assert.equal(parseLastEventId("1.5"), undefined);
  assert.equal(parseLastEventId("not-an-id"), undefined);
});
