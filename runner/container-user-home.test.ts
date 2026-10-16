import assert from "node:assert/strict";
import test from "node:test";
import { codexStoragePaths } from "@/lib/workspace-policy";
import { parseContainerUserHome } from "@/runner/container-user-home";

test("Codex storage follows the Dev Container user home", () => {
  assert.deepEqual(codexStoragePaths("/root"), {
    codexHome: "/root/.codex",
    codexSqliteHome: "/root/.codex-sqlite",
  });
  assert.deepEqual(codexStoragePaths("/home/node/"), {
    codexHome: "/home/node/.codex",
    codexSqliteHome: "/home/node/.codex-sqlite",
  });
});

test("container user homes must be a single absolute path", () => {
  assert.equal(parseContainerUserHome("/home/node\r\n"), "/home/node");
  assert.throws(() => parseContainerUserHome("home/node"), /determine/);
  assert.throws(() => parseContainerUserHome("/home/node\n/root"), /determine/);
});
