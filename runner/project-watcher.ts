import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { WORKSPACE_ROOT } from "@/runner/config";

const DEBOUNCE_MS = 350;

function isRelevantPath(filePath: string) {
  const relative = path.relative(WORKSPACE_ROOT, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length === 1) return !parts[0].startsWith(".");
  return !parts[0].startsWith(".") && parts[1] === ".devcontainer";
}

function shouldIgnore(filePath: string) {
  const relative = path.relative(WORKSPACE_ROOT, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length === 1) return parts[0].startsWith(".");
  return parts[0].startsWith(".") || parts[1] !== ".devcontainer";
}

/** Uses chokidar's native per-platform backends for project and .devcontainer changes. */
export async function startProjectWatcher(scan: () => Promise<void>) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(WORKSPACE_ROOT, { recursive: true }));
  let timer: NodeJS.Timeout | undefined;
  let scanRunning = false;
  let scanQueued = false;
  let closed = false;

  const runScan = () => {
    if (closed) return;
    if (scanRunning) {
      scanQueued = true;
      return;
    }
    scanRunning = true;
    void scan()
      .catch((error) => console.error("Project change scan failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        scanRunning = false;
        if (scanQueued) {
          scanQueued = false;
          runScan();
        }
      });
  };

  const scheduleScan = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      runScan();
    }, DEBOUNCE_MS);
    timer.unref();
  };

  const watcher: FSWatcher = chokidar.watch(WORKSPACE_ROOT, {
    ignored: shouldIgnore,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: DEBOUNCE_MS,
      pollInterval: 100,
    },
  });
  watcher.on("add", (filePath) => { if (isRelevantPath(filePath)) scheduleScan(); });
  watcher.on("change", (filePath) => { if (isRelevantPath(filePath)) scheduleScan(); });
  watcher.on("unlink", (filePath) => { if (isRelevantPath(filePath)) scheduleScan(); });
  watcher.on("addDir", (directory) => { if (isRelevantPath(directory)) scheduleScan(); });
  watcher.on("unlinkDir", (directory) => { if (isRelevantPath(directory)) scheduleScan(); });
  watcher.on("error", (error) => console.error("Project watcher failed:", error instanceof Error ? error.message : error));

  await new Promise<void>((resolve) => watcher.once("ready", resolve));

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    void watcher.close();
  };
}
