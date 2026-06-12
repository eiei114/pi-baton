import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

const widget = await import("../lib/run-widget.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");
const { loadWorkflowFromPath } = await import("../lib/workflow-discovery.ts");

const manifest = {
  id: "run-1",
  state: "running",
  workflowId: "default-review-loop",
  workflowName: "Default Review Loop",
  workflowPath: "ignored",
  workflowSource: "builtin",
  taskBrief: "Add a progress widget during baton runs",
  targetDirectory: "/tmp",
  entryStep: "implement",
  currentStep: "review",
  lastStep: "implement",
  iteration: 0,
  iterationCap: 5,
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z",
};

test("buildRunWidgetLines shows current step while running", async () => {
  const workflow = await loadWorkflowFromPath(
    join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
    { id: "default-review-loop", source: "builtin" },
  );

  const lines = widget.buildRunWidgetLines({
    phase: "step-start",
    manifest,
    workflow,
    stepName: "review",
    step: workflow.steps.review,
  });

  assert.match(lines.join("\n"), /running review/);
  assert.match(lines.join("\n"), /brief: Add a progress widget/);
});

test("buildRunStatusText reflects active step", () => {
  const status = widget.buildRunStatusText({
    phase: "step-start",
    manifest,
    workflow: { steps: {} },
    stepName: "implement",
  });

  assert.equal(status, "baton: implement");
});

test("buildRunStepChecklist marks current and completed steps", async () => {
  const workflow = await loadWorkflowFromPath(
    join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
    { id: "default-review-loop", source: "builtin" },
  );

  const checklist = widget.buildRunStepChecklist(workflow, {
    phase: "step-start",
    manifest,
    workflow,
    stepName: "review",
    step: workflow.steps.review,
  });

  assert.ok(checklist.some((line) => line.startsWith("✓ implement")));
  assert.ok(checklist.some((line) => line.startsWith("> review")));
});
