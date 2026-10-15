import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestOrigin } from "./request-origin";

test("uses the user's origin instead of a wildcard forwarded host", () => {
  const headers = new Headers({
    host: "localhost:3000",
    origin: "http://localhost:3000",
    "x-forwarded-host": "0.0.0.0:3000",
    "x-forwarded-proto": "http",
  });

  assert.equal(resolveRequestOrigin(headers, "http"), "http://localhost:3000");
});

test("uses Host when a document request has no Origin header", () => {
  const headers = new Headers({
    host: "192.168.1.20:3000",
    "x-forwarded-host": "0.0.0.0:3000",
    "x-forwarded-proto": "http",
  });

  assert.equal(resolveRequestOrigin(headers, "http"), "http://192.168.1.20:3000");
});

test("accepts the public origin supplied by a reverse proxy", () => {
  const headers = new Headers({
    host: "app:3000",
    origin: "https://coding.example.com",
    "x-forwarded-host": "coding.example.com",
    "x-forwarded-proto": "https",
  });

  assert.equal(resolveRequestOrigin(headers, "http"), "https://coding.example.com");
});

test("does not trust a cross-origin Origin header", () => {
  const headers = new Headers({
    host: "coding.example.com",
    origin: "https://attacker.example",
    "x-forwarded-proto": "https",
  });

  assert.equal(resolveRequestOrigin(headers, "http"), "https://coding.example.com");
});

test("rejects wildcard-only request authorities", () => {
  const headers = new Headers({ host: "0.0.0.0:3000" });

  assert.throws(
    () => resolveRequestOrigin(headers, "http"),
    /externally reachable request host/,
  );
});
