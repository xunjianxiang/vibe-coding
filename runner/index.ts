import "dotenv/config";
import path from "node:path";

process.env.APP_ROOT ??= path.resolve(__dirname, "..");

async function main() {
  const [{ createRunnerDb }, { scanProjects }, { reconcileOnce, syncRunningWorkspaceServiceLogs }, { startTerminalGateway }, { startDockerMonitor }, { startProjectWatcher }] = await Promise.all([
    import("@/runner/db"),
    import("@/runner/scanner"),
    import("@/runner/reconciler"),
    import("@/runner/terminal-gateway"),
    import("@/runner/docker-monitor"),
    import("@/runner/project-watcher"),
  ]);
  const db = createRunnerDb();
  let stopProjectWatcher: (() => void) | undefined;
  try {
    const command = process.argv[2] || "start";
    if (command === "scan") {
      await scanProjects(db);
      console.log("Project scan completed.");
      return;
    }
    if (command === "once") {
      await reconcileOnce(db);
      console.log("Workspace reconciliation completed.");
      return;
    }
    if (command !== "start") throw new Error(`Unknown runner command: ${command}`);

    let reconciliation = Promise.resolve();
    const reconcileSerialized = () => {
      const next = reconciliation.then(() => reconcileOnce(db));
      reconciliation = next.catch(() => undefined);
      return next;
    };

    let projectScan = Promise.resolve();
    const scanProjectsSerialized = () => {
      const next = projectScan.then(() => scanProjects(db));
      projectScan = next.catch(() => undefined);
      return next;
    };

    await scanProjectsSerialized().catch((error) => {
      console.error("Initial project scan failed; manual refresh remains available:", error instanceof Error ? error.message : error);
    });
    stopProjectWatcher = await startProjectWatcher(scanProjectsSerialized);
    await startTerminalGateway(db, reconcileSerialized, scanProjectsSerialized);
    console.log("Workspace Runner started.");

    const runLoop = async (name: string, task: () => Promise<void>, intervalMs = 5_000) => {
      while (true) {
        try {
          await task();
        } catch (error) {
          console.error(`${name} failed; retrying:`, error instanceof Error ? error.message : error);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    };

    await Promise.all([
      runLoop("Workspace reconciliation", reconcileSerialized),
      runLoop("Service log sync", () => syncRunningWorkspaceServiceLogs(db), 1_000),
      startDockerMonitor(db, reconcileSerialized),
    ]);
  } finally {
    stopProjectWatcher?.();
    await db.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
