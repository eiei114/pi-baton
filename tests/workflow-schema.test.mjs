import assert from "node:assert/strict";
import test from "node:test";

const { parseWorkflowDocument, WorkflowValidationError } = await import("../lib/workflow-schema.ts");

const validYaml = `
name: Test Loop
iteration_cap: 3
steps:
  implement:
    agent: worker
    prompt: do work
    next: review
  review:
    agent: reviewer
    prompt: review work
    on_accept: _complete
    on_reject: fix
  fix:
    agent: worker
    prompt: fix work
    next: review
`;

test("parseWorkflowDocument accepts a valid review loop", () => {
  const workflow = parseWorkflowDocument(validYaml, {
    id: "test-loop",
    source: "user",
    path: "/tmp/test-loop.yaml",
  });

  assert.equal(workflow.name, "Test Loop");
  assert.equal(workflow.iteration_cap, 3);
  assert.equal(workflow.steps.review.kind, "review");
  assert.equal(workflow.steps.implement.next, "review");
});

test("parseWorkflowDocument rejects invalid YAML and transitions", () => {
  assert.throws(
    () => parseWorkflowDocument("name: [", { id: "bad", source: "builtin", path: "bad.yaml" }),
    WorkflowValidationError,
  );

  assert.throws(
    () =>
      parseWorkflowDocument(
        `name: Bad
iteration_cap: 1
steps:
  implement:
    agent: worker
    prompt: x
    next: missing`,
        { id: "bad", source: "builtin", path: "bad.yaml" },
      ),
    /unknown step/,
  );
});
