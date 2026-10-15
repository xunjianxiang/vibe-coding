import path from "node:path";

export const APP_ROOT = path.resolve(
  /* turbopackIgnore: true */ process.env.APP_ROOT?.trim() || process.cwd(),
);

function resolveConfiguredRoot(name: string, configured: string | undefined, fallback: string) {
  const resolved = path.resolve(APP_ROOT, configured?.trim() || fallback);
  if (resolved === APP_ROOT) throw new Error(`${name} must not resolve to the application root.`);
  return resolved;
}

export const WORKSPACE_ROOT = resolveConfiguredRoot("WORKSPACE_ROOT", process.env.WORKSPACE_ROOT, ".workspace");
export const RUNNER_ROOT = resolveConfiguredRoot("RUNNER_ROOT", process.env.RUNNER_ROOT, ".runner");

if (path.relative(WORKSPACE_ROOT, RUNNER_ROOT) === "") {
  throw new Error("WORKSPACE_ROOT and RUNNER_ROOT must resolve to different directories.");
}
