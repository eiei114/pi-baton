import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  createIdleRun,
  loadActiveRun,
  updateRunState,
  ActiveRunGuardError,
} = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");

const runInput = {
  workflowId: "default-review-loop",
  workflowName: "Default Review Loop",
  workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
  workflowSource: "builtin",
  taskBrief: "hello",
  targetDirectory: "",
  entryStep: "implement",
  iterationCap: 2,
};

test("createIdleRun persists manifest and blocks second active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-"));
  runInput.targetDirectory = cwd;

  try {
    const manifest = await createIdleRun(cwd, runInput);

    assert.equal(manifest.state, "idle");
    const active = await loadActiveRun(cwd);
    assert.equal(active?.id, manifest.id);

    await assert.rejects(
      () =>
        createIdleRun(cwd, {
          ...runInput,
          taskBrief: "again",
        }),
      ActiveRunGuardError,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadActiveRun hides completed and failed runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-terminal-"));
  runInput.targetDirectory = cwd;

  try {
    const manifest = await createIdleRun(cwd, runInput);

    await updateRunState(cwd, manifest.id, { state: "running", currentStep: "implement" });
    assert.equal((await loadActiveRun(cwd))?.state, "running");

    await updateRunState(cwd, manifest.id, {
      state: "completed",
      currentStep: null,
      lastStep: "review",
    });
    assert.equal(await loadActiveRun(cwd), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("updateRunState transitions idle to running and records last step", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-transition-"));
  runInput.targetDirectory = cwd;

  try {
    const manifest = await createIdleRun(cwd, runInput);

    const running = await updateRunState(cwd, manifest.id, {
      state: "running",
      currentStep: "implement",
    });
    assert.equal(running.state, "running");

    const progressed = await updateRunState(cwd, manifest.id, {
      currentStep: "review",
      lastStep: "implement",
      iteration: 1,
    });
    assert.equal(progressed.lastStep, "implement");
    assert.equal(progressed.currentStep, "review");
    assert.equal(progressed.iteration, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
