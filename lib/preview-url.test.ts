import assert from "node:assert/strict";
import test from "node:test";
import { buildPreviewUrl } from "./preview-url";

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
