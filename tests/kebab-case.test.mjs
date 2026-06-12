import assert from "node:assert/strict";
import test from "node:test";

const { toKebabCase } = await import("../lib/kebab-case.ts");

test("toKebabCase normalizes workflow display names", () => {
  assert.equal(toKebabCase("My Workflow"), "my-workflow");
  assert.equal(toKebabCase("default review loop"), "default-review-loop");
  assert.equal(toKebabCase("  Foo_Bar  "), "foo-bar");
});
