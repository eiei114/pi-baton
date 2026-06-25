import assert from "node:assert/strict";
import test from "node:test";

const {
  buildFixHandoff,
  buildImplementHandoff,
  buildLinearHandoff,
  formatHandoffForPrompt,
} = await import("../lib/handoff.ts");

const manifest = {
  id: "20260620000000-abcd1234",
  state: "running",
  workflowId: "default-review-loop",
  workflowName: "Default Review Loop",
  workflowPath: "ignored",
  workflowSource: "builtin",
  taskBrief: "Add handoff tests",
  targetDirectory: "/tmp/project",
  entryStep: "implement",
  currentStep: "review",
  lastStep: "implement",
  iteration: 1,
  iterationCap: 5,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};

const previousEnvelope = {
  summary: "implemented feature",
  rawOutputPath: "/tmp/project/.pi/baton/runs/20260620000000-abcd1234/outputs/implement-0.md",
};

test("buildImplementHandoff carries task brief and run metadata only", () => {
  const handoff = buildImplementHandoff(manifest);

  assert.deepEqual(handoff, {
    taskBrief: "Add handoff tests",
    runMetadata: {
      runId: manifest.id,
      workflowName: "Default Review Loop",
      currentIteration: 1,
      targetDirectory: "/tmp/project",
    },
  });
  assert.equal(handoff.stepOutputSummary, undefined);
  assert.equal(handoff.rawOutputPath, undefined);
});

test("buildLinearHandoff carries prior summary and raw output path", () => {
  const handoff = buildLinearHandoff(manifest, previousEnvelope);

  assert.equal(handoff.taskBrief, manifest.taskBrief);
  assert.equal(handoff.stepOutputSummary, "implemented feature");
  assert.equal(handoff.rawOutputPath, previousEnvelope.rawOutputPath);
  assert.deepEqual(handoff.runMetadata.runId, manifest.id);
});

test("buildFixHandoff carries review findings and previous output summary", () => {
  const handoff = buildFixHandoff(manifest, previousEnvelope, ["fix tests", "tighten scope"]);

  assert.deepEqual(handoff.reviewFindings, ["fix tests", "tighten scope"]);
  assert.equal(handoff.previousOutputSummary, "implemented feature");
  assert.equal(handoff.rawOutputPath, previousEnvelope.rawOutputPath);
  assert.equal(handoff.stepOutputSummary, undefined);
});

test("formatHandoffForPrompt isolates handoff sections for downstream prompts", () => {
  const prompt = formatHandoffForPrompt(buildLinearHandoff(manifest, previousEnvelope));

  assert.match(prompt, /## Task brief/);
  assert.match(prompt, /Add handoff tests/);
  assert.match(prompt, /## Previous step summary/);
  assert.match(prompt, /implemented feature/);
  assert.match(prompt, /## Raw output path/);
  assert.doesNotMatch(prompt, /## Review findings/);
});
