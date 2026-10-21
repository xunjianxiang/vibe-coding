import assert from "node:assert/strict";
import test from "node:test";
import { splitProcessOutput } from "@/runner/process";

test("splits newline-delimited output", () => {
  assert.deepEqual(splitProcessOutput("", "one\ntwo\n"), { messages: ["one", "two"], buffer: "" });
});

test("splits carriage-return progress frames", () => {
  assert.deepEqual(splitProcessOutput("", "Downloading 10%\rDownloading 20%\r"), {
    messages: ["Downloading 10%", "Downloading 20%"],
    buffer: "",
  });
});

test("keeps an incomplete frame across chunks", () => {
  const first = splitProcessOutput("", "Loading");
  assert.deepEqual(splitProcessOutput(first.buffer, "...\rDone\n"), { messages: ["Loading...", "Done"], buffer: "" });
});
