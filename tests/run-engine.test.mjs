import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { runContinuous } = await import("../lib/run-engine.ts");
const { createIdleRun, loadActiveRun, readRunManifest } = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir, getRunOutputsDir, getRunStepsDir } = await import("../lib/paths.ts");

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

    const finalManifest = await readRunManifest(cwd, manifest.id);
    assert.equal(finalManifest.state, "completed");

    const stepFiles = await readdir(getRunStepsDir(cwd, manifest.id));
    const outputFiles = await readdir(getRunOutputsDir(cwd, manifest.id));
    assert.ok(stepFiles.length >= 2);
    assert.ok(outputFiles.length >= 2);

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

test("runContinuous routes fix back to review and completes on accept", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));
  const stepSequence = [];
  let reviewPass = 0;

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Fix loop test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 3,
    });

    const summary = await runContinuous({
      cwd,
      runId: manifest.id,
      stepRunner: async (request) => {
        stepSequence.push(request.agent === "worker" ? "worker" : "reviewer");

        if (request.agent === "worker") {
          const label = stepSequence.filter((s) => s === "worker").length === 1 ? "implemented" : "fixed";
          return { exitCode: 0, outputText: workerOutput(label), stderr: "" };
        }

        reviewPass += 1;
        const judgment = reviewPass === 1 ? "reject" : "accept";
        return { exitCode: 0, outputText: reviewOutput(judgment), stderr: "" };
      },
    });

    assert.equal(summary.state, "completed");
    assert.deepEqual(stepSequence, ["worker", "reviewer", "worker", "reviewer"]);
    assert.equal(summary.iteration, 1);

    const stepFiles = await readdir(getRunStepsDir(cwd, manifest.id));
    assert.equal(stepFiles.length, 4);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runContinuous resolves step model override and session fallback", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));
  const models = [];

  const workflowPath = join(cwd, "model-routing.yaml");
  await writeFile(
    workflowPath,
    `name: Model Routing Test
iteration_cap: 2
steps:
  implement:
    agent: worker
    model: openai/gpt-fast
    prompt: |
      Implement.
      End with JSON: {"summary":"done"}
    next: review
  review:
    agent: reviewer
    model: <your-strong-model>
    prompt: |
      Review.
      End with JSON: {"summary":"ok","judgment":"accept","acceptanceNote":"pass"}
    on_accept: _complete
    on_reject: implement
`,
    "utf8",
  );

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "model-routing",
      workflowName: "Model Routing Test",
      workflowPath,
      workflowSource: "user",
      taskBrief: "Model routing test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    await runContinuous({
      cwd,
      runId: manifest.id,
      sessionModel: { provider: "anthropic", id: "session-model" },
      stepRunner: async (request) => {
        models.push(request.model);
        if (request.agent === "worker") {
          return { exitCode: 0, outputText: workerOutput("done"), stderr: "" };
        }
        return { exitCode: 0, outputText: reviewOutput("accept"), stderr: "" };
      },
    });

    assert.deepEqual(models, ["openai/gpt-fast", "anthropic/session-model"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runContinuous fails on review contract violation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Contract test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    const summary = await runContinuous({
      cwd,
      runId: manifest.id,
      stepRunner: async (request) => {
        if (request.agent === "worker") {
          return { exitCode: 0, outputText: workerOutput("done"), stderr: "" };
        }
        return {
          exitCode: 0,
          outputText: 'bad\n```json\n{"summary":"x","judgment":"reject","findings":[]}\n```',
          stderr: "",
        };
      },
    });

    assert.equal(summary.state, "failed");
    assert.match(summary.failureReason ?? "", /findings/);
    assert.equal(summary.lastStep, "review");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runContinuous persists structured step envelopes for all steps", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-run-"));

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Envelope test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    await runContinuous({
      cwd,
      runId: manifest.id,
      stepRunner: async (request) => {
        if (request.agent === "worker") {
          return { exitCode: 0, outputText: workerOutput("worker summary"), stderr: "" };
        }
        return { exitCode: 0, outputText: reviewOutput("accept"), stderr: "" };
      },
    });

    const stepFiles = await readdir(getRunStepsDir(cwd, manifest.id));
    const records = await Promise.all(
      stepFiles.map(async (file) => JSON.parse(await readFile(join(getRunStepsDir(cwd, manifest.id), file), "utf8"))),
    );

    const implement = records.find((record) => record.stepName === "implement");
    const review = records.find((record) => record.stepName === "review");

    assert.ok(implement?.envelope.summary);
    assert.ok(implement?.envelope.rawOutputPath);
    assert.equal(implement?.envelope.judgment, undefined);

    assert.equal(review?.envelope.judgment, "accept");
    assert.equal(review?.envelope.acceptanceNote, "approved");
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
    assert.equal(summary.lastStep, "implement");
    assert.match(summary.failureReason ?? "", /boom/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
