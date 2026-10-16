import assert from "node:assert/strict";
import test from "node:test";
import { buildPreviewUrl, findPublishedServicePort } from "./preview-url";

test("uses the current page hostname with the published service port", () => {
  assert.equal(
    buildPreviewUrl("http://127.0.0.1:32781/", "192.168.1.25"),
    "http://192.168.1.25:32781/",
  );
});

test("preserves the service protocol, path, query, and fragment", () => {
  assert.equal(
    buildPreviewUrl("https://runner.internal:32781/app?q=1#result", "workspace.example.com"),
    "https://workspace.example.com:32781/app?q=1#result",
  );
});

test("supports an IPv6 page hostname", () => {
  assert.equal(
    buildPreviewUrl("http://127.0.0.1:32781/", "[2001:db8::1]"),
    "http://[2001:db8::1]:32781/",
  );
});

test("keeps the service URL when it cannot be parsed", () => {
  assert.equal(buildPreviewUrl("not a url", "192.168.1.25"), "not a url");
});

test("finds a published service by container or host port", () => {
  const ports = [{ containerPort: 5173, hostPort: 12001, url: "http://127.0.0.1:12001/" }];

  assert.equal(findPublishedServicePort(ports, 5173), ports[0]);
  assert.equal(findPublishedServicePort(ports, 12001), ports[0]);
  assert.equal(findPublishedServicePort(ports, 3000), null);
});
