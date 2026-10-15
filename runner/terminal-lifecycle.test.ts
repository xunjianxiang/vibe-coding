import assert from "node:assert/strict";
import test from "node:test";
import { shouldReclaimTerminalRuntime } from "@/lib/workspace-policy";

const NOW = Date.parse("2026-10-15T08:00:00.000Z");

test("visible Workspace presence prevents terminal runtime reclamation", () => {
  assert.equal(shouldReclaimTerminalRuntime(
    NOW - 1,
    new Date(NOW + 60_000),
    NOW,
  ), false);
});

test("recent terminal input or output prevents reclamation after the page leaves", () => {
  assert.equal(shouldReclaimTerminalRuntime(
    NOW + 60_000,
    new Date(NOW - 1),
    NOW,
  ), false);
});

test("runtime is reclaimable only after both deadlines expire", () => {
  assert.equal(shouldReclaimTerminalRuntime(
    NOW - 1,
    new Date(NOW - 1),
    NOW,
  ), true);
});

test("missing Workspace presence permits reclamation after terminal inactivity", () => {
  assert.equal(shouldReclaimTerminalRuntime(NOW - 1, null, NOW), true);
});
