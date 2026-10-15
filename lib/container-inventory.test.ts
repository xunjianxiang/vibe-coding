import assert from "node:assert/strict";
import test from "node:test";
import { isSafeOrphanCleanup } from "@/lib/container-inventory";

const managedLabels = { "platform.managed": "true" };

test("allows cleanup when a managed container has no Workspace", () => {
  assert.equal(isSafeOrphanCleanup("container-a", managedLabels, null), true);
});

test("allows cleanup when the Workspace points to a different container", () => {
  assert.equal(isSafeOrphanCleanup("container-a", managedLabels, { containerId: "container-b" }), true);
});

test("rejects cleanup after the container becomes the Workspace primary container", () => {
  assert.equal(isSafeOrphanCleanup("container-a", managedLabels, { containerId: "container-a" }), false);
});

test("rejects cleanup while the Workspace has not selected a primary container", () => {
  assert.equal(isSafeOrphanCleanup("container-a", managedLabels, { containerId: null }), false);
});

test("rejects cleanup for containers not managed by the platform", () => {
  assert.equal(isSafeOrphanCleanup("container-a", {}, null), false);
});
