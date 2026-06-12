import assert from "node:assert/strict";
import test from "node:test";

const { resolveStepModel } = await import("../lib/model-routing.ts");

test("resolveStepModel uses step override and falls back to session model", () => {
  assert.equal(resolveStepModel("openai/gpt-test", { provider: "anthropic", id: "claude" }), "openai/gpt-test");
  assert.equal(resolveStepModel("<your-fast-model>", { provider: "anthropic", id: "claude" }), "anthropic/claude");
  assert.equal(resolveStepModel(undefined, { provider: "google", id: "gemini" }), "google/gemini");
});
