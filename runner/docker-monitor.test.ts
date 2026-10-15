import assert from "node:assert/strict";
import test from "node:test";
import { classifyContainerStop } from "@/runner/docker-monitor";

test("requested stop takes precedence over exit evidence", () => {
  assert.equal(classifyContainerStop(137, true, true), "REQUESTED");
});

test("explicit OOM evidence classifies the stop as OOM", () => {
  assert.equal(classifyContainerStop(137, true, false), "OOM");
});

test("exit code 137 alone is not treated as OOM", () => {
  assert.equal(classifyContainerStop(137, false, false), "PROCESS_ERROR");
});

test("zero exit without a stop request is a normal exit", () => {
  assert.equal(classifyContainerStop(0, false, false), "NORMAL_EXIT");
});

test("missing evidence remains unknown", () => {
  assert.equal(classifyContainerStop(null, false, false), "UNKNOWN");
});
