import assert from "node:assert/strict";
import test from "node:test";
import { buildGatewayPreviewUrl, buildPreviewUrl, findPublishedServicePort } from "./preview-url";

test("uses the current page hostname with the published service port", () => {
  assert.equal(buildPreviewUrl("http://127.0.0.1:32781/", "192.168.1.25"), "http://192.168.1.25:32781/");
});

test("preserves the service protocol, path, query, and fragment", () => {
  assert.equal(
    buildPreviewUrl("https://runner.internal:32781/app?q=1#result", "workspace.example.com"),
    "https://workspace.example.com:32781/app?q=1#result",
  );
});

test("supports an IPv6 page hostname", () => {
  assert.equal(buildPreviewUrl("http://127.0.0.1:32781/", "[2001:db8::1]"), "http://[2001:db8::1]:32781/");
});

test("keeps the service URL when it cannot be parsed", () => {
  assert.equal(buildPreviewUrl("not a url", "192.168.1.25"), "not a url");
});

test("builds a nip.io URL when Gateway is configured", () => {
  assert.equal(
    buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 5173, "192.168.12.112", "3100", "true"),
    "http://550e8400-e29b-41d4-a716-446655440000.5173.192-168-12-112.nip.io:3100/",
  );
});

test("builds a localhost URL by default", () => {
  assert.equal(
    buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 5173, undefined, "3100", "true"),
    "http://550e8400-e29b-41d4-a716-446655440000.5173.localhost:3100/",
  );
});

test("returns no Gateway URL when Gateway is not configured", () => {
  assert.equal(buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 5173, undefined, undefined), null);
});

test("returns no Gateway URL when Gateway is disabled", () => {
  assert.equal(
    buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 5173, "192.168.12.112", "3100", "false"),
    null,
  );
});

test("rejects malformed Gateway inputs", () => {
  assert.equal(buildGatewayPreviewUrl("invalid", 5173, "192.168.12.112", "3100", "true"), null);
  assert.equal(buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 0, "192.168.12.112", "3100", "true"), null);
  assert.equal(buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 5173, "999.1.1.1", "3100", "true"), null);
  assert.equal(buildGatewayPreviewUrl("550e8400-e29b-41d4-a716-446655440000", 5173, "192.168.12.112", "70000", "true"), null);
});

test("finds a published service by container or host port", () => {
  const ports = [{ containerPort: 5173, hostPort: 12001, url: "http://127.0.0.1:12001/" }];
  assert.equal(findPublishedServicePort(ports, 5173), ports[0]);
  assert.equal(findPublishedServicePort(ports, 12001), ports[0]);
  assert.equal(findPublishedServicePort(ports, 3000), null);
});
