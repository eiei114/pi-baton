import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { runContinuous } = await import("../lib/run-engine.ts");
const { createIdleRun, loadActiveRun } = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");

function reviewOutput(judgment, extra = {}) {
  return `reviewed\n\`\`\`json\n${JSON.stringify({
    summary: "review summary",
    judgment,
    ...(judgment === "accept"
      ? { acceptanceNote: "approved" }
      : { findings: ["needs fix"] }),
    ...extra,
  })}\n\`\`\``;
}

function workerOutput(summary) {
  return `done\n\`\`\`json\n${JSON.stringify({ summary })}\n\`\`\``;
}

test("runContinuous completes accept path with isolated handoff payload", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));
  const prompts = [];

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Add tests",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 3,
    });

    const summary = await runContinuous({
      cwd,
      runId: manifest.id,
      sessionModel: { provider: "anthropic", id: "claude-test" },
      stepRunner: async (request) => {
        prompts.push(request.prompt);
        if (request.agent === "worker") {
          return { exitCode: 0, outputText: workerOutput("implemented"), stderr: "" };
        }
        return { exitCode: 0, outputText: reviewOutput("accept"), stderr: "" };
      },
    });

    assert.equal(summary.state, "completed");
    assert.equal(summary.lastStep, "review");
    assert.match(prompts[1], /Previous step summary/);
    assert.match(prompts[1], /Raw output path/);
    assert.doesNotMatch(prompts[1], /implemented[\s\S]{0,40}implemented/);

    const active = await loadActiveRun(cwd);
    assert.equal(active, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runContinuous loops fix and fails at iteration cap", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));
  let reviewCount = 0;

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Loop test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 1,
    });

    const summary = await runContinuous({
      cwd,
      runId: manifest.id,
      stepRunner: async (request) => {
        if (request.agent === "worker") {
          return { exitCode: 0, outputText: workerOutput("work"), stderr: "" };
        }

        reviewCount += 1;
        return { exitCode: 0, outputText: reviewOutput("reject"), stderr: "" };
      },
    });

    assert.equal(summary.state, "failed");
    assert.match(summary.failureReason ?? "", /Iteration cap/);
    assert.ok(reviewCount >= 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runContinuous fails immediately on step execution failure", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Fail test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    const summary = await runContinuous({
      cwd,
      runId: manifest.id,
      stepRunner: async () => ({ exitCode: 1, outputText: "", stderr: "boom" }),
    });

    assert.equal(summary.state, "failed");
    assert.match(summary.failureReason ?? "", /boom/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
