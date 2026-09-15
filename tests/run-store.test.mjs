import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  createIdleRun,
  loadActiveRun,
  loadMostRecentTerminalRun,
  setActiveRunPointer,
  updateRunState,
  ActiveRunGuardError,
} = await import("../lib/run-store.ts");
const { getActiveRunPointerPath, getPackageWorkflowsDir, getRunManifestPath } = await import("../lib/paths.ts");

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

    const failedManifest = await createIdleRun(cwd, { ...runInput, taskBrief: "failed path" });
    await updateRunState(cwd, failedManifest.id, { state: "running", currentStep: "implement" });
    await updateRunState(cwd, failedManifest.id, {
      state: "failed",
      currentStep: null,
      lastStep: "implement",
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

test("loadActiveRun returns null when active pointer targets unreadable manifest", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-corrupt-active-"));
  const runId = "20260623000000-corrupt01";

  try {
    const runDir = join(cwd, ".pi", "baton", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(getRunManifestPath(cwd, runId), "{not-json", "utf8");
    await writeFile(getActiveRunPointerPath(cwd), `${JSON.stringify({ runId })}\n`, "utf8");

    assert.equal(await loadActiveRun(cwd), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createIdleRun succeeds when active pointer targets unreadable manifest", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-recover-corrupt-"));
  const runId = "20260623000000-corrupt02";
  runInput.targetDirectory = cwd;

  try {
    const runDir = join(cwd, ".pi", "baton", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(getRunManifestPath(cwd, runId), "{not-json", "utf8");
    await setActiveRunPointer(cwd, runId);

    const manifest = await createIdleRun(cwd, { ...runInput, taskBrief: "recovered after corrupt pointer" });
    assert.equal(manifest.state, "idle");
    assert.notEqual(manifest.id, runId);
    assert.equal((await loadActiveRun(cwd))?.id, manifest.id);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadMostRecentTerminalRun returns null for unreadable manifest", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-corrupt-terminal-"));
  const runId = "20260623000000-corrupt03";

  try {
    const runDir = join(cwd, ".pi", "baton", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(getRunManifestPath(cwd, runId), "{not-json", "utf8");
    await setActiveRunPointer(cwd, runId);

    assert.equal(await loadMostRecentTerminalRun(cwd), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadMostRecentTerminalRun returns null when pointer targets non-terminal run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-nonterminal-pointer-"));
  runInput.targetDirectory = cwd;

  try {
    const manifest = await createIdleRun(cwd, { ...runInput, taskBrief: "still running" });
    await updateRunState(cwd, manifest.id, { state: "running", currentStep: "implement" });

    assert.equal(await loadMostRecentTerminalRun(cwd), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadMostRecentTerminalRun exposes failed run with iteration-cap reason", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-failed-terminal-"));
  runInput.targetDirectory = cwd;

  try {
    const manifest = await createIdleRun(cwd, { ...runInput, taskBrief: "cap exhausted" });
    await updateRunState(cwd, manifest.id, {
      state: "failed",
      currentStep: "review",
      lastStep: "fix",
      iteration: 2,
      failureReason: "Iteration cap (2) reached",
    });

    const terminal = await loadMostRecentTerminalRun(cwd);
    assert.equal(terminal?.state, "failed");
    assert.match(terminal?.failureReason ?? "", /Iteration cap \(2\) reached/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
