import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scaffold = await import("../lib/workflow-scaffold.ts");
const { ensureBatonScaffolding } = await import("../lib/paths.ts");

test("derived scaffold inserts model placeholders for worker and reviewer", () => {
  const builtinYaml = `name: Default Review Loop
iteration_cap: 5
steps:
  implement:
    agent: worker
    prompt: implement
    next: review
  review:
    agent: reviewer
    prompt: review
    on_accept: _complete
    on_reject: fix
  fix:
    agent: worker
    prompt: fix
    next: review
`;

  const derived = scaffold.buildDerivedScaffoldYaml(builtinYaml);
  assert.match(derived, /model: <your-fast-model>/);
  assert.match(derived, /model: <your-strong-model>/);
  assert.doesNotMatch(derived, /model: <your-fast-model>[\s\S]*model: <your-fast-model>[\s\S]*model: <your-fast-model>/);
});

test("deriveWorkflowFilename converts display names to kebab-case yaml files", () => {
  assert.equal(scaffold.deriveWorkflowFilename("My Review Loop"), "my-review-loop.yaml");
});

test("ensureBatonScaffolding creates .pi/baton paths lazily", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-paths-"));
  const workflowsDir = join(cwd, ".pi", "baton", "workflows");

  try {
    await assert.rejects(() => access(workflowsDir));
    await ensureBatonScaffolding(cwd);
    await access(workflowsDir);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createWorkflowScaffold writes file and rejects collisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-baton-scaffold-"));

  try {
    const first = await scaffold.createWorkflowScaffold(dir, "Custom Loop");
    assert.equal(first.filename, "custom-loop.yaml");

    const saved = await readFile(first.filePath, "utf8");
    assert.match(saved, /^name: Custom Loop/m);
    assert.match(saved, /model: <your-fast-model>/);

    await assert.rejects(
      () => scaffold.createWorkflowScaffold(dir, "Custom Loop"),
      scaffold.WorkflowNameCollisionError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
