import type Docker from "dockerode";
import type { Duplex } from "node:stream";
import { finished } from "node:stream/promises";

export function parseContainerUserHome(output: string) {
  const home = output.trim();
  if (!home.startsWith("/") || home.includes("\0") || /[\r\n]/.test(home)) {
    throw new Error("Unable to determine the Dev Container user home directory.");
  }
  return home;
}

export async function resolveContainerUserHome(container: Docker.Container, remoteUser: string) {
  const command = "awk -F: -v uid=\"$(id -u)\" '$3 == uid { print $6; found=1; exit } END { if (!found) exit 1 }' /etc/passwd";
  const lookup = await container.exec({
    AttachStdout: true,
    AttachStderr: false,
    Tty: true,
    User: remoteUser,
    Cmd: ["sh", "-lc", command],
  });
  const chunks: Buffer[] = [];
  const stream = await lookup.start({ hijack: true, stdin: false, Tty: true }) as unknown as Duplex;
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  await finished(stream);
  const result = await lookup.inspect();
  if (result.ExitCode !== 0) {
    throw new Error("Unable to determine the Dev Container user home directory.");
  }
  return parseContainerUserHome(Buffer.concat(chunks).toString("utf8"));
}
