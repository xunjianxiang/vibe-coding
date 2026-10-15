import assert from "node:assert/strict";
import test from "node:test";
import { isWebSocketOriginAllowed } from "@/lib/trusted-origins";

test("allows same-origin WebSockets", () => {
  assert.equal(isWebSocketOriginAllowed("http://192.168.12.112:3000", "192.168.12.112:3000"), true);
  assert.equal(isWebSocketOriginAllowed("http://devbox.local:3000", "devbox.local:3000"), true);
});

test("rejects cross-origin and malformed WebSocket origins", () => {
  assert.equal(isWebSocketOriginAllowed("http://other-host:3000", "192.168.12.112:3000"), false);
  assert.equal(isWebSocketOriginAllowed("http://localhost:3000/workspace", "localhost:3000"), false);
  assert.equal(isWebSocketOriginAllowed(undefined, "localhost:3000"), false);
});
