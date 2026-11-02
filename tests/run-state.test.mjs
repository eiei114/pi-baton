import assert from "node:assert/strict";
import test from "node:test";

const { isTerminalRunState } = await import("../lib/run-state.ts");

test("isTerminalRunState recognizes only completed and failed runs", () => {
  assert.equal(isTerminalRunState("completed"), true);
  assert.equal(isTerminalRunState("failed"), true);
  assert.equal(isTerminalRunState("idle"), false);
  assert.equal(isTerminalRunState("running"), false);
  assert.equal(isTerminalRunState("unknown"), false);
  assert.equal(isTerminalRunState(null), false);
});
