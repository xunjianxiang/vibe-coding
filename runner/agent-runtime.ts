import type { TerminalAgent } from "@/lib/terminal-ticket";

const CODEX_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function getAgentLaunchSpec(
  agent: TerminalAgent,
  agentHome: string,
  agentSqliteHome: string,
  nativeSessionId: string | null,
) {
  switch (agent) {
    case "codex":
      if (nativeSessionId && !CODEX_SESSION_ID.test(nativeSessionId)) {
        throw new Error("Stored Codex session ID is invalid.");
      }
      return {
        command: nativeSessionId
          ? `exec codex resume ${shellQuote(nativeSessionId)} --no-daemon --yolo`
          : "exec codex --no-daemon --yolo",
        env: [
          `CODEX_HOME=${agentHome}`,
          `CODEX_SQLITE_HOME=${agentSqliteHome}`,
        ],
      };
  }
}

export function getAgentSessionDiscoveryCommand(agent: TerminalAgent, agentHome: string, markerPath: string) {
  switch (agent) {
    case "codex":
      return `find ${shellQuote(`${agentHome}/sessions`)} -type f -name 'rollout-*.jsonl' -newer ${shellQuote(markerPath)} -print 2>/dev/null | sort | tail -n 1`;
  }
}

export function parseAgentSessionId(agent: TerminalAgent, output: string) {
  switch (agent) {
    case "codex": {
      const path = output.trim().split(/\r?\n/).at(-1) ?? "";
      const match = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
      return match?.[1] ?? null;
    }
  }
}
