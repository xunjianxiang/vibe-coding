import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const HASH_VERSION = "vibe-devcontainer-v1";

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Dev Container configuration cannot contain symbolic links: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) files.push(...await collectFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export async function hashDevcontainerDirectory(workspacePath: string) {
  const root = path.join(workspacePath, ".devcontainer");
  const files = await collectFiles(root);
  files.sort((left, right) => path.relative(root, left).localeCompare(path.relative(root, right), "en"));

  const hash = createHash("sha256");
  hash.update(`${HASH_VERSION}\0`);
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const contentHash = createHash("sha256").update(await readFile(file)).digest("hex");
    hash.update(`${relative.length}:${relative}:${contentHash}\0`);
  }
  return hash.digest("hex");
}
