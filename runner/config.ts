import path from "node:path";

if (!process.env.APP_ROOT) throw new Error("APP_ROOT was not initialized by the Runner entrypoint.");
export const APP_ROOT = path.resolve(process.env.APP_ROOT);

export function getProjectsRoot() {
  const configured = process.env.PROJECTS_ROOT?.trim() || ".projects";
  const resolved = path.resolve(APP_ROOT, configured);
  if (resolved === APP_ROOT) throw new Error("PROJECTS_ROOT must not resolve to the application root.");
  return resolved;
}
