import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceGitStatus = {
  branch: string;
  added: number;
  modified: number;
  deleted: number;
};

type ContainerInspect = {
  Config?: { Labels?: Record<string, string> };
  Mounts?: Array<{ Type?: string; Source?: string; Destination?: string }>;
  State?: { Running?: boolean };
};

const CACHE_TTL_MS = 1_500;
const cache = new Map<string, { expiresAt: number; value: WorkspaceGitStatus | null }>();
const pending = new Map<string, Promise<WorkspaceGitStatus | null>>();

async function runDocker(args: string[]) {
  const result = await execFileAsync("docker", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 5_000,
    windowsHide: true,
  });
  return result.stdout;
}

export function parseGitStatusOutput(output: string): WorkspaceGitStatus | null {
  const records = output.split("\0");
  const branch = records.shift()?.trim();
  if (!branch) return null;

  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 3) continue;
    const status = record.slice(0, 2);
    if (status === "!!") continue;
    if (status === "??" || status.includes("A")) added += 1;
    else if (status.includes("D")) deleted += 1;
    else modified += 1;
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return { branch, added, modified, deleted };
}

function runtimeLocation(container: ContainerInspect, workspacePath: string) {
  if (!container.State?.Running) throw new Error("Workspace container is not running.");
  const labels = container.Config?.Labels ?? {};
  const mount = container.Mounts?.find((candidate) => candidate.Type === "bind"
    && candidate.Source
    && path.resolve(candidate.Source).toLowerCase() === path.resolve(workspacePath).toLowerCase());
  if (!mount?.Destination) throw new Error("Workspace bind mount was not found in the container.");

  let remoteUser: string | undefined;
  const metadata = labels["devcontainer.metadata"];
  if (metadata) {
    const entries = JSON.parse(metadata) as Array<{ remoteUser?: string }>;
    remoteUser = entries.findLast((entry) => entry.remoteUser)?.remoteUser;
  }
  if (!remoteUser) throw new Error("Dev Container remoteUser is required to read Git status.");
  return { labels, remoteUser, workspaceFolder: mount.Destination };
}

async function readUncached({
  containerId,
  workspaceId,
  projectId,
  workspacePath,
}: {
  containerId: string;
  workspaceId: string;
  projectId: string;
  workspacePath: string;
}) {
  const inspected = JSON.parse(await runDocker(["inspect", containerId])) as ContainerInspect[];
  const location = runtimeLocation(inspected[0] ?? {}, workspacePath);
  if (location.labels["platform.managed"] !== "true"
    || location.labels["platform.workspace_id"] !== workspaceId
    || location.labels["platform.project_id"] !== projectId) {
    throw new Error("Workspace container ownership could not be verified.");
  }

  const script = [
    "branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null) || exit 1",
    "printf '%s\\000' \"$branch\"",
    "git -c core.quotepath=false status --porcelain=v1 -z --untracked-files=all",
  ].join("; ");
  const stdout = await runDocker([
    "exec",
    "--user", location.remoteUser,
    "--workdir", location.workspaceFolder,
    containerId,
    "sh", "-lc", script,
  ]);
  return parseGitStatusOutput(stdout);
}

export async function readWorkspaceGitStatus(input: {
  containerId: string | null;
  workspaceId: string;
  projectId: string;
  workspacePath: string;
}): Promise<WorkspaceGitStatus | null> {
  if (!input.containerId) return null;
  const cached = cache.get(input.containerId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = pending.get(input.containerId);
  if (inFlight) return inFlight;

  const request = readUncached({ ...input, containerId: input.containerId })
    .catch(() => null)
    .then((value) => {
      cache.set(input.containerId!, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => pending.delete(input.containerId!));
  pending.set(input.containerId, request);
  return request;
}
