import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { formatStatusSummary, NO_ACTIVE_RUN_MESSAGE } = await import("../lib/status.ts");
const { runContinuous } = await import("../lib/run-engine.ts");
const { createIdleRun, loadMostRecentTerminalRun, updateRunState } = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");

function reviewOutput(judgment) {
  return `reviewed\n\`\`\`json\n${JSON.stringify({
    summary: "review summary",
    judgment,
    ...(judgment === "accept"
      ? { acceptanceNote: "approved" }
      : { findings: ["needs fix"] }),
  })}\n\`\`\``;
}

function workerOutput(summary) {
  return `done\n\`\`\`json\n${JSON.stringify({ summary })}\n\`\`\``;
}

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

test("formatStatusSummary shows finished framing for terminal runs", () => {
  const completed = formatStatusSummary({
    ...manifest,
    state: "completed",
    currentStep: null,
    lastStep: "review",
    iteration: 2,
  });

  assert.match(completed, /This Baton run has finished \(completed\)\./);
  assert.match(completed, /last step: review/);
  assert.match(completed, /run state: completed/);
  assert.match(completed, /iteration count: 2/);

  const failed = formatStatusSummary({
    ...manifest,
    state: "failed",
    currentStep: null,
    lastStep: "implement",
    iteration: 1,
  });

  assert.match(failed, /This Baton run has finished \(failed\)\./);
  assert.match(failed, /last step: implement/);
  assert.match(failed, /run state: failed/);
  assert.doesNotMatch(failed, /failure:/);
});

test("formatStatusSummary surfaces iteration-cap failure reason for terminal failed runs", () => {
  const iterationCapFailure = formatStatusSummary({
    ...manifest,
    state: "failed",
    currentStep: "review",
    lastStep: "fix",
    iteration: 2,
    iterationCap: 2,
    failureReason: "Iteration cap (2) reached",
  });

  assert.match(iterationCapFailure, /This Baton run has finished \(failed\)\./);
  assert.match(iterationCapFailure, /failure: Iteration cap \(2\) reached/);
  assert.match(iterationCapFailure, /run state: failed/);
});

test("formatStatusSummary surfaces non-iteration-cap failure reasons", () => {
  const contractFailure = formatStatusSummary({
    ...manifest,
    state: "failed",
    currentStep: null,
    lastStep: "review",
    iteration: 1,
    failureReason: "Review reject requires non-empty findings",
  });

  assert.match(contractFailure, /failure: Review reject requires non-empty findings/);
  assert.doesNotMatch(contractFailure, /Iteration cap/);
});

test("loadMostRecentTerminalRun exposes the latest completed or failed run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-status-terminal-"));

  try {
    const created = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Terminal status test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    await updateRunState(cwd, created.id, {
      state: "completed",
      currentStep: null,
      lastStep: "review",
      iteration: 2,
    });

    const terminal = await loadMostRecentTerminalRun(cwd);
    assert.equal(terminal?.id, created.id);
    assert.equal(terminal?.state, "completed");
    assert.equal(terminal?.lastStep, "review");

    assert.ok(terminal);
    const summary = formatStatusSummary(terminal);
    assert.match(summary, /This Baton run has finished \(completed\)\./);
    assert.match(summary, /task brief: Terminal status test/);
    assert.match(summary, /run directory: \.pi\/baton\/runs\//);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadMostRecentTerminalRun status output includes iteration-cap failure reason", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-status-iteration-cap-"));

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Iteration cap status test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 1,
    });

    await runContinuous({
      cwd,
      runId: manifest.id,
      stepRunner: async (request) => {
        if (request.agent === "worker") {
          return { exitCode: 0, outputText: workerOutput("work"), stderr: "" };
        }

        return { exitCode: 0, outputText: reviewOutput("reject"), stderr: "" };
      },
    });

    const terminal = await loadMostRecentTerminalRun(cwd);
    assert.equal(terminal?.state, "failed");
    assert.match(terminal?.failureReason ?? "", /Iteration cap \(1\) reached/);

    const summary = formatStatusSummary(terminal);
    assert.match(summary, /This Baton run has finished \(failed\)\./);
    assert.match(summary, /failure: Iteration cap \(1\) reached/);
    assert.match(summary, /task brief: Iteration cap status test/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("NO_ACTIVE_RUN_MESSAGE guides users to /baton:start", () => {
  assert.match(NO_ACTIVE_RUN_MESSAGE, /No active Baton run/);
  assert.match(NO_ACTIVE_RUN_MESSAGE, /\/baton:start/);
});
