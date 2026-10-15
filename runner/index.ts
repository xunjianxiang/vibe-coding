import "dotenv/config";
import path from "node:path";

process.env.APP_ROOT ??= path.resolve(__dirname, "..");

async function main() {
  const [{ createRunnerDb }, { scanProjects }, { reconcileOnce }, { startTerminalGateway }, { startDockerMonitor }] = await Promise.all([
    import("@/runner/db"),
    import("@/runner/scanner"),
    import("@/runner/reconciler"),
    import("@/runner/terminal-gateway"),
    import("@/runner/docker-monitor"),
  ]);
  const db = createRunnerDb();
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

    await startTerminalGateway(db, reconcileSerialized);
    console.log("Workspace Runner started.");

    const runLoop = async (name: string, task: () => Promise<void>) => {
      while (true) {
        try {
          await task();
        } catch (error) {
          console.error(`${name} failed; retrying:`, error instanceof Error ? error.message : error);
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    };

    await Promise.all([
      runLoop("Project scan", () => scanProjects(db)),
      runLoop("Workspace reconciliation", reconcileSerialized),
      startDockerMonitor(db, reconcileSerialized),
    ]);
  } finally {
    await db.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
