import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { RealtimeMessage } from "@/lib/realtime";

const MAX_REALTIME_BUFFER = 256 * 1024;
const clientsBySub = new Map<string, Set<WebSocket>>();

export function addRealtimeClient(sub: string, client: WebSocket) {
  const clients = clientsBySub.get(sub) ?? new Set<WebSocket>();
  clients.add(client);
  clientsBySub.set(sub, clients);
  client.once("close", () => {
    clients.delete(client);
    if (clients.size === 0) clientsBySub.delete(sub);
  });
}

function message(type: RealtimeMessage["type"], data: RealtimeMessage["data"], scope?: RealtimeMessage["scope"]): RealtimeMessage {
  return { v: 1, id: randomUUID(), type, occurredAt: new Date().toISOString(), ...(scope ? { scope } : {}), data };
}

function send(clients: Iterable<WebSocket>, payload: RealtimeMessage) {
  const encoded = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.bufferedAmount > MAX_REALTIME_BUFFER) {
      client.close(1013, "Realtime client is too slow.");
      continue;
    }
    client.send(encoded);
  }
}

export function publishToUser(sub: string, type: RealtimeMessage["type"], data: RealtimeMessage["data"], scope?: RealtimeMessage["scope"]) {
  const clients = clientsBySub.get(sub);
  if (clients) send(clients, message(type, data, scope));
}

export function publishToAll(type: RealtimeMessage["type"], data: RealtimeMessage["data"]) {
  const payload = message(type, data);
  for (const clients of clientsBySub.values()) send(clients, payload);
}
