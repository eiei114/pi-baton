import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { discoverWorkflowItems, loadWorkflowById } = await import("../lib/workflow-discovery.ts");

const userWorkflow = `name: User First
iteration_cap: 2
steps:
  implement:
    agent: worker
    prompt: go
    next: review
  review:
    agent: reviewer
    prompt: check
    on_accept: _complete
    on_reject: implement
`;

test("discoverWorkflowItems lists the two-stage review gauntlet builtin workflow", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-discovery-builtin-"));

  try {
    const items = await discoverWorkflowItems(cwd);
    const item = items.find((candidate) => candidate.id === "two-stage-review-gauntlet");
    assert.equal(item?.name, "Two-Stage Review Gauntlet");
    assert.equal(item?.source, "builtin");

    const workflow = await loadWorkflowById(cwd, "two-stage-review-gauntlet");
    assert.equal(workflow.iteration_cap, 4);
    assert.equal(workflow.entryStep, "draft");
    assert.equal(workflow.steps.draft.kind, "linear");
    assert.equal(workflow.steps.draft.next, "technical_review");
    assert.equal(workflow.steps.technical_review.kind, "review");
    assert.equal(workflow.steps.technical_review.on_accept, "editorial_review");
    assert.equal(workflow.steps.technical_review.on_reject, "fix");
    assert.equal(workflow.steps.editorial_review.kind, "review");
    assert.equal(workflow.steps.editorial_review.on_accept, "_complete");
    assert.equal(workflow.steps.editorial_review.on_reject, "fix");
    assert.equal(workflow.steps.fix.kind, "linear");
    assert.equal(workflow.steps.fix.next, "technical_review");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("discoverWorkflowItems fails validation for invalid user workflow YAML", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-discovery-invalid-"));
  const workflowsDir = join(cwd, ".pi", "baton", "workflows");

  try {
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(
      join(workflowsDir, "broken.yaml"),
      "name: Broken\niteration_cap: 1\nsteps:\n  a:\n    agent: worker\n    prompt: x\n    next: missing\n",
      "utf8",
    );

    await assert.rejects(() => discoverWorkflowItems(cwd), /unknown step "missing"/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadWorkflowById loads a builtin workflow without scanning unrelated user YAML", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-discovery-direct-"));
  const workflowsDir = join(cwd, ".pi", "baton", "workflows");

  try {
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, "broken.yaml"), "name: Broken\nsteps: {}\n", "utf8");

    const workflow = await loadWorkflowById(cwd, "default-review-loop");
    assert.equal(workflow.id, "default-review-loop");
    assert.equal(workflow.source, "builtin");
    assert.equal(workflow.entryStep, "implement");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadWorkflowById rejects unknown workflow ids", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-discovery-unknown-"));

  try {
    await assert.rejects(() => loadWorkflowById(cwd, "missing-workflow"), /Unknown workflow: missing-workflow/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadWorkflowById rejects workflow ids that escape the workflow directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-baton-discovery-traversal-"));
  const cwd = join(root, "cwd");
  const workflowsDir = join(cwd, ".pi", "baton", "workflows");

  try {
    await mkdir(workflowsDir, { recursive: true });
    // A valid workflow one level above the workflow directory must stay unreachable by id.
    await writeFile(join(cwd, ".pi", "baton", "escaped.yaml"), userWorkflow, "utf8");

    await assert.rejects(() => loadWorkflowById(cwd, "../escaped"), /Unknown workflow: \.\.\/escaped/);
    await assert.rejects(() => loadWorkflowById(cwd, "..\\escaped"), /Unknown workflow/);
    await assert.rejects(() => loadWorkflowById(cwd, ".."), /Unknown workflow/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverWorkflowItems lists user-defined workflows before builtin", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-discovery-"));
  const workflowsDir = join(cwd, ".pi", "baton", "workflows");

  try {
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, "user-first.yaml"), userWorkflow, "utf8");

    const items = await discoverWorkflowItems(cwd);
    assert.ok(items.length >= 2);
    assert.equal(items[0].name, "User First");
    assert.equal(items[0].source, "user");
    assert.equal(items.at(-1)?.source, "builtin");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
