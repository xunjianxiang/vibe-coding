import assert from "node:assert/strict";
import test from "node:test";
import { createIdempotencyKey } from "@/lib/idempotency-key";

test("uses randomUUID when the browser exposes it", () => {
  const expected = "3cc07c53-5a70-4543-9512-a8f26229c6bf";
  const cryptoApi = {
    randomUUID: () => expected as `${string}-${string}-${string}-${string}-${string}`,
    getRandomValues: <T extends ArrayBufferView | null>(array: T) => array,
  };

  assert.equal(createIdempotencyKey(cryptoApi), expected);
});

test("falls back to getRandomValues on an insecure HTTP origin", () => {
  const cryptoApi = {
    getRandomValues: <T extends ArrayBufferView | null>(array: T) => {
      if (array instanceof Uint8Array) array.set(Array.from({ length: 16 }, (_, index) => index));
      return array;
    },
  };

  assert.equal(createIdempotencyKey(cryptoApi), "000102030405060708090a0b0c0d0e0f");
});
