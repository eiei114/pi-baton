import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const contributing = await readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
const publishWorkflow = await readFile(
  new URL("../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);
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

test("ROADMAP latest release matches package version", async () => {
  const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
  const match = roadmap.match(/Latest release \| \*\*(\d+\.\d+\.\d+)\*\*/);

  assert.ok(match, "ROADMAP should document the latest release version");
  assert.equal(match[1], packageJson.version);
});

test("CONTRIBUTING release instructions use auto-release push flow", () => {
  assert.doesNotMatch(contributing, /--follow-tags/);
  assert.match(contributing, /npm version patch\s+git push/m);
  assert.match(contributing, /auto-release/);
});

test("publish workflow avoids duplicate main push trigger for version bumps", () => {
  assert.doesNotMatch(publishWorkflow, /branches:\s*\n\s*- main/);
  assert.match(publishWorkflow, /tags:\s*\n\s*- 'v\*\.\*\.\*'/);
});

async function countTestCases() {
  const testsDir = fileURLToPath(new URL("../tests/", import.meta.url));
  const files = (await readdir(testsDir)).filter((name) => name.endsWith(".test.mjs"));
  let total = 0;

  for (const file of files) {
    const source = await readFile(join(testsDir, file), "utf8");
    total += (source.match(/^test\(/gm) ?? []).length;
  }

  return total;
}

test("ROADMAP test inventory matches the node:test suite size", async () => {
  const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
  const testCount = await countTestCases();
  const surfaceMapMatch = roadmap.match(
    /\| `tests\/\*\.test\.mjs` \| (\d+) tests /,
  );
  const ciStatusMatch = roadmap.match(/typecheck \+ (\d+) tests \+ `npm pack --dry-run`/);

  assert.ok(surfaceMapMatch, "ROADMAP surface map should document the test suite size");
  assert.ok(ciStatusMatch, "ROADMAP release status should document the CI test count");
  assert.equal(Number(surfaceMapMatch[1]), testCount);
  assert.equal(Number(ciStatusMatch[1]), testCount);
});

test("ROADMAP marks shipped two-stage review gauntlet seed as done", async () => {
  const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
  const gauntlet = await readFile(
    new URL("../workflows/two-stage-review-gauntlet.yaml", import.meta.url),
    "utf8",
  );

  assert.match(gauntlet, /^name: Two-Stage Review Gauntlet/m);
  assert.match(roadmap, /### S-108 — Add a second builtin workflow \(non-review shape\) `\[done\]`/);
  assert.doesNotMatch(roadmap, /### S-108 — Add a second builtin workflow \(non-review shape\) `\[backlog\]`/);
  const s108 = roadmap.match(
    /<a id="s-108"><\/a>[\s\S]*?(?=\n---)/,
  )?.[0];
  assert.ok(s108);
  assert.equal((s108.match(/^- \[x\]/gm) ?? []).length, 4);
  assert.doesNotMatch(s108, /^- \[ \]/m);
  assert.match(
    roadmap,
    /### 0\.9\.0 — Workflow authoring depth[\s\S]*?Two-stage review gauntlet builtin workflow.*shipped in 0\.7\.5\./,
  );
});
