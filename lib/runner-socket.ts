import path from "node:path";
import { RUNNER_ROOT } from "@/lib/runtime-paths";

export const RUNNER_SOCKET_IS_FILESYSTEM = process.platform !== "win32";
export const RUNNER_SOCKET_PATH = RUNNER_SOCKET_IS_FILESYSTEM
  ? path.join(RUNNER_ROOT, "runner.sock")
  : "\\\\.\\pipe\\vibe-coding-runner";
