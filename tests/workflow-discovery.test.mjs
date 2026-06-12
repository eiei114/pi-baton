import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { discoverWorkflowItems } = await import("../lib/workflow-discovery.ts");

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
