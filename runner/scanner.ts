import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { WORKSPACE_ROOT } from "@/runner/config";
import { run, runDevcontainer } from "@/runner/process";
import { validateContainerConfig } from "@/runner/security";

type Validation = { status: "READY" | "INVALID"; error: string | null };

async function validateProject(projectPath: string): Promise<Validation> {
  try {
    const git = await run("git", ["rev-parse", "--is-inside-work-tree"], projectPath);
    if (git.stdout.trim() !== "true") throw new Error("Directory is not a Git work tree.");

    const result = await runDevcontainer(["read-configuration", "--include-merged-configuration", "--workspace-folder", projectPath]);
    const config = JSON.parse(result.stdout) as Record<string, unknown>;
    const errors = validateContainerConfig(config, projectPath);

    const composeFiles = config.configuration && typeof config.configuration === "object"
      ? (config.configuration as Record<string, unknown>).dockerComposeFile
      : undefined;
    const files = Array.isArray(composeFiles) ? composeFiles : composeFiles ? [composeFiles] : [];
    if (files.length) {
      const args = ["compose", ...files.flatMap((file) => ["-f", path.resolve(projectPath, String(file))]), "config", "--format", "json"];
      const compose = await run("docker", args, projectPath);
      errors.push(...validateContainerConfig(JSON.parse(compose.stdout), projectPath));
    }

    return errors.length ? { status: "INVALID", error: [...new Set(errors)].join("; ") } : { status: "READY", error: null };
  } catch (error) {
    return { status: "INVALID", error: error instanceof Error ? error.message : "Project validation failed." };
  }
}

export async function scanProjects(db: PrismaClient) {
  const root = WORKSPACE_ROOT;
  await fs.mkdir(root, { recursive: true });
  const rootRealPath = await fs.realpath(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const candidate = path.join(root, entry.name);
    const realPath = await fs.realpath(candidate);
    const relative = path.relative(rootRealPath, realPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    seen.add(entry.name);

    const validation = await validateProject(realPath);
    const now = new Date();
    await db.project.upsert({
      where: { key: entry.name },
      create: { key: entry.name, path: realPath, status: validation.status, error: validation.error, seenAt: now, checkedAt: now },
      update: { path: realPath, status: validation.status, error: validation.error, seenAt: now, checkedAt: now },
    });
  }

  await db.project.updateMany({ where: { key: { notIn: [...seen] } }, data: { status: "MISSING", error: "Project directory is missing.", checkedAt: new Date() } });
}
