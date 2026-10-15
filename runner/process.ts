import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { APP_ROOT } from "@/runner/config";

const execFileAsync = promisify(execFile);

export async function run(command: string, args: string[], cwd?: string, timeout = 60_000) {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export type ProcessOutputLine = { stream: "stdout" | "stderr"; message: string };

export function runStreaming(
  command: string,
  args: string[],
  cwd: string | undefined,
  timeout: number,
  onLine: (line: ProcessOutputLine) => void | Promise<void>,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let deliveries = Promise.resolve();
    let timedOut = false;

    const deliver = (stream: ProcessOutputLine["stream"], message: string) => {
      deliveries = deliveries.then(() => onLine({ stream, message }));
    };
    const consume = (stream: ProcessOutputLine["stream"], chunk: Buffer) => {
      const value = chunk.toString("utf8");
      if (stream === "stdout") stdout = (stdout + value).slice(-16 * 1024 * 1024);
      else stderr = (stderr + value).slice(-16 * 1024 * 1024);
      const lines = ((stream === "stdout" ? stdoutBuffer : stderrBuffer) + value).split(/\r?\n/);
      const trailing = lines.pop() ?? "";
      if (stream === "stdout") stdoutBuffer = trailing;
      else stderrBuffer = trailing;
      for (const message of lines) deliver(stream, message);
    };

    child.stdout.on("data", (chunk: Buffer) => consume("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => consume("stderr", chunk));
    child.on("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (stdoutBuffer) deliver("stdout", stdoutBuffer);
      if (stderrBuffer) deliver("stderr", stderrBuffer);
      void deliveries.then(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const reason = timedOut
          ? `Command timed out after ${timeout}ms.`
          : `Command exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
        const error = new Error(`${reason}${stderr.trim() ? ` ${stderr.trim()}` : ""}`);
        Object.assign(error, { stdout, stderr, code });
        reject(error);
      }, reject);
    });
  });
}

const requireFromApp = createRequire(path.join(APP_ROOT, "package.json"));
const devcontainerEntrypoint = requireFromApp.resolve("@devcontainers/cli/devcontainer.js");

export function runDevcontainer(args: string[], cwd?: string, timeout?: number) {
  return run(process.execPath, [devcontainerEntrypoint, ...args], cwd, timeout);
}

export function runDevcontainerStreaming(
  args: string[],
  cwd: string | undefined,
  timeout: number,
  onLine: (line: ProcessOutputLine) => void | Promise<void>,
) {
  return runStreaming(process.execPath, [devcontainerEntrypoint, ...args], cwd, timeout, onLine);
}
