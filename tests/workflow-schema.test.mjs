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

function parse(yamlText) {
  return parseWorkflowDocument(yamlText, {
    id: "test-loop",
    source: "user",
    path: "/tmp/test-loop.yaml",
  });
}

test("parseWorkflowDocument accepts a valid review loop", () => {
  const workflow = parse(validYaml);

  assert.equal(workflow.name, "Test Loop");
  assert.equal(workflow.iteration_cap, 3);
  assert.equal(workflow.steps.review.kind, "review");
  assert.equal(workflow.steps.implement.next, "review");
  assert.equal(workflow.steps.review.on_accept, "_complete");
  assert.equal(workflow.steps.review.on_reject, "fix");
});

test("parseWorkflowDocument uses YAML name as workflow display name", () => {
  const workflow = parse(validYaml.replace("name: Test Loop", "name: Custom Display Name"));
  assert.equal(workflow.name, "Custom Display Name");
});

test("parseWorkflowDocument rejects invalid YAML", () => {
  assert.throws(
    () => parse("name: ["),
    (error) => error instanceof WorkflowValidationError && /Invalid YAML/.test(error.message),
  );
});

test("parseWorkflowDocument rejects missing required root fields", () => {
  assert.throws(() => parse("steps:\n  a:\n    agent: worker\n    prompt: x\n    next: a"), /name must be/);
  assert.throws(
    () => parse("name: Missing Cap\nsteps:\n  a:\n    agent: worker\n    prompt: x\n    next: a"),
    /iteration_cap is required/,
  );
  assert.throws(() => parse("name: Missing Steps\niteration_cap: 1"), /steps must be/);
});

test("parseWorkflowDocument rejects invalid iteration_cap values", () => {
  const base = `name: Cap
steps:
  a:
    agent: worker
    prompt: x
    next: a`;

  assert.throws(() => parse(`${base.replace("name: Cap", "name: Cap\niteration_cap: 0")}`), /positive integer/);
  assert.throws(() => parse(`${base.replace("name: Cap", "name: Cap\niteration_cap: -1")}`), /positive integer/);
  assert.throws(() => parse(`${base.replace("name: Cap", "name: Cap\niteration_cap: 1.5")}`), /positive integer/);
  assert.throws(() => parse(`${base.replace("name: Cap", "name: Cap\niteration_cap: two")}`), /positive integer/);
});

test("parseWorkflowDocument rejects missing step fields", () => {
  assert.throws(
    () =>
      parse(`name: Step
iteration_cap: 1
steps:
  implement:
    prompt: x
    next: implement`),
    /steps\.implement\.agent must be/,
  );

  assert.throws(
    () =>
      parse(`name: Step
iteration_cap: 1
steps:
  implement:
    agent: worker
    next: implement`),
    /steps\.implement\.prompt must be/,
  );
});

test("parseWorkflowDocument validates linear next-step transitions", () => {
  assert.throws(
    () =>
      parse(`name: Linear
iteration_cap: 1
steps:
  implement:
    agent: worker
    prompt: x
    next: missing`),
    /unknown step "missing"/,
  );

  const workflow = parse(`name: Linear
iteration_cap: 1
steps:
  implement:
    agent: worker
    prompt: x
    next: finish
  finish:
    agent: worker
    prompt: done
    next: finish`);

  assert.equal(workflow.steps.implement.kind, "linear");
  assert.equal(workflow.steps.implement.next, "finish");
});

test("parseWorkflowDocument validates review branch transitions", () => {
  assert.throws(
    () =>
      parse(`name: Review
iteration_cap: 1
steps:
  review:
    agent: reviewer
    prompt: check
    on_accept: _complete
    on_reject: missing`),
    /unknown step "missing"/,
  );

  assert.throws(
    () =>
      parse(`name: Review
iteration_cap: 1
steps:
  review:
    agent: reviewer
    prompt: check
    on_accept: missing
    on_reject: review`),
    /unknown step "missing"/,
  );

  const workflow = parse(`name: Review
iteration_cap: 1
steps:
  review:
    agent: reviewer
    prompt: check
    on_accept: polish
    on_reject: fix
  polish:
    agent: worker
    prompt: polish
    next: review
  fix:
    agent: worker
    prompt: fix
    next: review`);

  assert.equal(workflow.steps.review.on_accept, "polish");
  assert.equal(workflow.steps.review.on_reject, "fix");
});

test("parseWorkflowDocument rejects mixed linear and review transitions", () => {
  assert.throws(
    () =>
      parse(`name: Mixed
iteration_cap: 1
steps:
  review:
    agent: reviewer
    prompt: check
    next: fix
    on_accept: _complete
    on_reject: fix`),
    /cannot mix next with review branches/,
  );

  assert.throws(
    () =>
      parse(`name: Incomplete Review
iteration_cap: 1
steps:
  review:
    agent: reviewer
    prompt: check
    on_accept: _complete`),
    /must define next or both on_accept and on_reject/,
  );
});
