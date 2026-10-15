import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.APP_ROOT ??= process.cwd();

async function loadProcessServices(root: string) {
  const services = await import("@/runner/services");
  return services.loadProcessServices(root);
}

async function withManifest(manifest: unknown, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe-services-"));
  try {
    await mkdir(path.join(root, ".devcontainer"));
    await writeFile(path.join(root, ".devcontainer", "metadata.json"), JSON.stringify(manifest), "utf8");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loads a service port from a numeric string", async () => {
  await withManifest({
    services: [{
      id: "web",
      name: "Web",
      port: "5173",
      browser: true,
      command: "npm run dev",
      stdout: "/tmp/services/web.stdout.log",
    }],
  }, async (root) => {
    const [service] = await loadProcessServices(root);
    assert.equal(service.port, 5173);
    assert.equal(service.browser, true);
  });
});

test("defaults a service to a non-browser port", async () => {
  await withManifest({
    services: [{
      id: "database",
      name: "Database",
      port: 5432,
      command: "postgres",
      stdout: "/tmp/services/database.stdout.log",
    }],
  }, async (root) => {
    const [service] = await loadProcessServices(root);
    assert.equal(service.port, 5432);
    assert.equal(service.browser, false);
  });
});

test("rejects an invalid service port", async () => {
  await withManifest({
    services: [{
      id: "web",
      name: "Web",
      port: "70000",
      command: "npm run dev",
      stdout: "/tmp/services/web.stdout.log",
    }],
  }, async (root) => {
    await assert.rejects(() => loadProcessServices(root), /port must be an integer from 1 to 65535/);
  });
});

test("rejects a non-boolean browser flag", async () => {
  await withManifest({
    services: [{
      id: "web",
      name: "Web",
      port: 5173,
      browser: "yes",
      command: "npm run dev",
      stdout: "/tmp/services/web.stdout.log",
    }],
  }, async (root) => {
    await assert.rejects(() => loadProcessServices(root), /browser must be a boolean/);
  });
});
