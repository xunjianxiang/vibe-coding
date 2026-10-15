import "server-only";
import { request } from "node:http";

const runnerSocket = process.platform === "win32"
  ? "\\\\.\\pipe\\vibe-coding-runner"
  : "/run/vibe-coding/runner.sock";

export type RunnerCleanupResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 503; error: string };

export function cleanupOrphanContainer(containerId: string): Promise<RunnerCleanupResult> {
  return new Promise((resolve) => {
    const clientRequest = request({
      socketPath: runnerSocket,
      path: `/internal/containers/${encodeURIComponent(containerId)}/cleanup`,
      method: "POST",
      headers: { connection: "close" },
      timeout: 15_000,
    }, (response) => {
      response.resume();
      response.once("end", () => {
        if (response.statusCode === 204) return resolve({ ok: true });
        if (response.statusCode === 404) return resolve({ ok: false, status: 404, error: "CONTAINER_NOT_FOUND" });
        if (response.statusCode === 409) return resolve({ ok: false, status: 409, error: "CONTAINER_NOT_ORPHANED" });
        resolve({ ok: false, status: 503, error: "RUNNER_UNAVAILABLE" });
      });
    });

    clientRequest.once("timeout", () => clientRequest.destroy(new Error("Runner request timed out.")));
    clientRequest.once("error", () => resolve({ ok: false, status: 503, error: "RUNNER_UNAVAILABLE" }));
    clientRequest.end();
  });
}
