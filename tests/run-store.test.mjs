import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createIdleRun, loadActiveRun, ActiveRunGuardError } = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");

test("createIdleRun persists manifest and blocks second active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-store-"));

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "hello",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    assert.equal(manifest.state, "idle");
    const active = await loadActiveRun(cwd);
    assert.equal(active?.id, manifest.id);

    await assert.rejects(
      () =>
        createIdleRun(cwd, {
          workflowId: "default-review-loop",
          workflowName: "Default Review Loop",
          workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
          workflowSource: "builtin",
          taskBrief: "again",
          targetDirectory: cwd,
          entryStep: "implement",
          iterationCap: 2,
        }),
      ActiveRunGuardError,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
