import assert from "node:assert/strict";
import test from "node:test";
import { decryptToken, encryptToken, InvalidSessionTokenError } from "@/lib/auth/crypto";

const originalKey = process.env.SESSION_ENCRYPTION_KEY;

test.beforeEach(() => {
  process.env.SESSION_ENCRYPTION_KEY = "test-session-key";
});

test.after(() => {
  if (originalKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = originalKey;
});

test("round-trips an encrypted token", () => {
  const token = "header.payload.signature";
  assert.equal(decryptToken(encryptToken(token)), token);
});

test("rejects a token that fails authentication", () => {
  const encrypted = encryptToken("header.payload.signature");
  const [iv, tag, ciphertext] = encrypted.split(".");
  const replacement = ciphertext.startsWith("A") ? "B" : "A";
  const tampered = `${iv}.${tag}.${replacement}${ciphertext.slice(1)}`;

  assert.throws(() => decryptToken(tampered), InvalidSessionTokenError);
});

test("rejects a token encrypted with a previous key", () => {
  const encrypted = encryptToken("header.payload.signature");
  process.env.SESSION_ENCRYPTION_KEY = "rotated-session-key";

  assert.throws(() => decryptToken(encrypted), InvalidSessionTokenError);
});

test("rejects malformed encrypted token payloads", () => {
  for (const value of ["", "one-part", "one.two", "one.two.three.four", "***.tag.token"]) {
    assert.throws(() => decryptToken(value), InvalidSessionTokenError);
  }
});

test("does not classify a missing encryption key as an invalid session", () => {
  delete process.env.SESSION_ENCRYPTION_KEY;
  assert.throws(
    () => decryptToken("a.b.c"),
    (error: unknown) => error instanceof Error && error.message === "SESSION_ENCRYPTION_KEY is required.",
  );
});
