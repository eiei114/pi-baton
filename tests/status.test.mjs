import assert from "node:assert/strict";
import test from "node:test";

const { formatStatusSummary, NO_ACTIVE_RUN_MESSAGE } = await import("../lib/status.ts");

const manifest = {
  id: "20260620000000-abcd1234",
  state: "idle",
  workflowId: "default-review-loop",
  workflowName: "Default Review Loop",
  workflowPath: "ignored",
  workflowSource: "builtin",
  taskBrief: "Ship start/status commands",
  targetDirectory: "/tmp",
  entryStep: "implement",
  currentStep: "implement",
  lastStep: null,
  iteration: 0,
  iterationCap: 2,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};

test("formatStatusSummary reports workflow, brief, steps, state, and iteration", () => {
  const summary = formatStatusSummary(manifest);

  assert.match(summary, /workflow: Default Review Loop/);
  assert.match(summary, /task brief: Ship start\/status commands/);
  assert.match(summary, /last step: \(none\)/);
  assert.match(summary, /current step: implement/);
  assert.match(summary, /run state: idle/);
  assert.match(summary, /iteration count: 0/);
  assert.match(summary, /run directory: \.pi\/baton\/runs\/20260620000000-abcd1234/);
});

test("formatStatusSummary shows last step after progress", () => {
  const summary = formatStatusSummary({
    ...manifest,
    state: "running",
    currentStep: "review",
    lastStep: "implement",
    iteration: 1,
  });

  assert.match(summary, /last step: implement/);
  assert.match(summary, /current step: review/);
  assert.match(summary, /run state: running/);
  assert.match(summary, /iteration count: 1/);
});

test("NO_ACTIVE_RUN_MESSAGE guides users to /baton:start", () => {
  assert.match(NO_ACTIVE_RUN_MESSAGE, /No active Baton run/);
  assert.match(NO_ACTIVE_RUN_MESSAGE, /\/baton:start/);
});
