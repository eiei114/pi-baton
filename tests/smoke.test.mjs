import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const builtinWorkflow = await readFile(
  new URL("../workflows/default-review-loop.yaml", import.meta.url),
  "utf8",
);

test("package declares pi extension entrypoint", () => {
  assert.deepEqual(packageJson.pi.extensions, ["./extensions"]);
  assert.ok(packageJson.files.includes("workflows/"));
});

test("package ships default-review-loop builtin workflow", () => {
  assert.match(builtinWorkflow, /^name: Default Review Loop/m);
  assert.match(builtinWorkflow, /agent: worker/);
  assert.match(builtinWorkflow, /agent: reviewer/);
  assert.doesNotMatch(builtinWorkflow, /model:/);
});

test("package is discoverable as a Pi package", () => {
  assert.ok(packageJson.keywords.includes("pi-package"));
});

test("package uses public publish config", () => {
  assert.equal(packageJson.publishConfig.access, "public");
});

test("README pinned install example matches package version", () => {
  const match = readme.match(/pi install npm:pi-baton@(\d+\.\d+\.\d+)/);
  assert.ok(match, "README should include a pinned npm install example");
  assert.equal(match[1], packageJson.version);
});
