import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

const agents = await import("../lib/agents.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");
const { loadWorkflowFromPath } = await import("../lib/workflow-discovery.ts");

test("discoverAgents includes builtin worker and reviewer", () => {
  const discovered = agents.discoverAgents(process.cwd(), "both");
  const names = discovered.map((agent) => agent.name);
  assert.ok(names.includes("worker"));
  assert.ok(names.includes("reviewer"));

  const worker = discovered.find((agent) => agent.name === "worker");
  assert.equal(worker?.source, "builtin");
  assert.equal(worker?.model, undefined);
});

test("validateWorkflowAgents passes for default-review-loop", async () => {
  const workflow = await loadWorkflowFromPath(
    join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
    { id: "default-review-loop", source: "builtin" },
  );

  assert.doesNotThrow(() => agents.validateWorkflowAgents(process.cwd(), workflow));
});

test("MissingAgentsError lists missing and available agents", () => {
  const error = new agents.MissingAgentsError(["worker"], ["reviewer", "planner"]);
  assert.deepEqual(error.missing, ["worker"]);
  assert.match(error.message, /worker/);
  assert.match(error.message, /reviewer/);
});
