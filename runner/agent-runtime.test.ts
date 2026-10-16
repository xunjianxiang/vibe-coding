import assert from "node:assert/strict";
import test from "node:test";
import { getAgentLaunchSpec, getAgentSessionDiscoveryCommand, parseAgentSessionId } from "@/runner/agent-runtime";

const CODEX_HOME = "/root/.codex";
const CODEX_SQLITE_HOME = "/root/.codex-sqlite";
const SESSION_ID = "01a13940-1244-7452-9a4b-4028e918936f";

test("a new Codex runtime starts without an implicit resume", () => {
  const spec = getAgentLaunchSpec("codex", CODEX_HOME, CODEX_SQLITE_HOME, null);

  assert.equal(spec.command, "exec codex --no-daemon");
  assert.deepEqual(spec.env, [
    `CODEX_HOME=${CODEX_HOME}`,
    `CODEX_SQLITE_HOME=${CODEX_SQLITE_HOME}`,
  ]);
});

test("a Codex runtime resumes the explicitly recorded native session", () => {
  const spec = getAgentLaunchSpec("codex", CODEX_HOME, CODEX_SQLITE_HOME, SESSION_ID);

  assert.equal(spec.command, `exec codex resume '${SESSION_ID}' --no-daemon`);
  assert.doesNotMatch(spec.command, /--last/);
});

test("Codex session IDs are read from rollout paths", () => {
  assert.equal(parseAgentSessionId(
    "codex",
    `${CODEX_HOME}/sessions/2026/10/15/rollout-2026-10-15T06-08-04-${SESSION_ID}.jsonl\n`,
  ), SESSION_ID);
  assert.equal(parseAgentSessionId("codex", ""), null);
});

test("Codex session discovery is scoped to the current runtime", () => {
  const marker = `${CODEX_HOME}/.session-start-1`;
  const command = getAgentSessionDiscoveryCommand("codex", CODEX_HOME, marker);

  assert.match(command, / -newer /);
  assert.match(command, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("invalid stored Codex session IDs are rejected", () => {
  assert.throws(() => getAgentLaunchSpec("codex", CODEX_HOME, CODEX_SQLITE_HOME, "--last"), /invalid/);
});
