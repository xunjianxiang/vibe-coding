const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const DEVCONTAINER_TIMESTAMP = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\s*/;

export function stripAnsi(message: string) {
  return message.replace(ANSI_ESCAPE, "");
}

export function normalizeStartupLogMessage(message: string) {
  if (message === "") return message;
  const withoutAnsi = stripAnsi(message);
  const withoutTimestamp = withoutAnsi.replace(DEVCONTAINER_TIMESTAMP, "");
  if (!withoutTimestamp) return null;
  return withoutTimestamp;
}
