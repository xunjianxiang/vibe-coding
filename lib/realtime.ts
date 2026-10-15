export type RealtimeMessage = {
  v: 1;
  id: string;
  type: "workspace.status.changed" | "container.status.changed" | "runner.health.changed";
  occurredAt: string;
  scope?: { projectId?: string; workspaceId?: string };
  data: Record<string, unknown>;
};

export type RealtimeConnectionState = "connected" | "reconnecting" | "disconnected";
