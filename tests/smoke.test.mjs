import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluatePinnedInstall, labelsVersionAsUnpublished, parsePinnedInstall } from "../scripts/readme-install-contract.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const workflowsGuide = await readFile(new URL("../docs/workflows.md", import.meta.url), "utf8");
const contributing = await readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
const autoReleaseWorkflow = await readFile(
  new URL("../.github/workflows/auto-release.yml", import.meta.url),
  "utf8",
);
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

test("README pinned install example is installable or labeled as not yet published", () => {
  const pinned = parsePinnedInstall(readme);
  assert.ok(pinned, "README should include a pinned npm install example");

  // The pin must name the package this repository publishes. A pin for another
  // package at the same version would resolve on the registry and look fine to a
  // version-only comparison.
  assert.equal(
    pinned.packageName,
    packageJson.name,
    "README's pinned install example must install the package this repository publishes",
  );

  if (pinned.version === packageJson.version) return;

  // A version bump merged to main is not published by itself: a maintainer must
  // complete an explicit release action (docs/release.md). A pinned example that
  // differs from this tree's version therefore copies an unreleased specifier, so
  // README must label package.json's version as not yet installable instead of
  // presenting the copied command as working.
  assert.ok(
    labelsVersionAsUnpublished(readme, packageJson.version),
    "README pins a version other than package.json, so it must label package.json's version as not yet published",
  );

  // Negative controls for the label matcher itself: the label must be a standalone
  // version mention next to an unpublished marker, so a passing test cannot be an
  // artifact of substring matching.
  assert.equal(labelsVersionAsUnpublished("pin pi-baton@0.9.3", "0.9.3"), false);
  assert.equal(labelsVersionAsUnpublished("pi-baton@10.9.3 is upcoming", "0.9.3"), false);
  assert.equal(labelsVersionAsUnpublished("0.9.30 is upcoming", "0.9.3"), false);
  assert.equal(labelsVersionAsUnpublished("0.9.3 is\nupcoming", "0.9.3"), true);

  // Regression: README documents the newest published version and the next
  // unpublished version in the same paragraph. A fixed character window let the
  // 0.9.3 marker reclassify the published 0.9.2 mention, which turned a 404 probe
  // of the pinned version into a false success.
  const neighboringVersions = [
    "`0.9.2` is the newest version published on npm. The next release, `0.9.3`, is",
    "prepared in CHANGELOG.md but is **not yet published**.",
  ].join("\n");
  assert.equal(
    labelsVersionAsUnpublished(neighboringVersions, "0.9.2"),
    false,
    "the unpublished 0.9.3 label must not classify the published 0.9.2 mention as unpublished",
  );
  assert.equal(labelsVersionAsUnpublished(neighboringVersions, "0.9.3"), true);
});

test("pinned install version captures the complete token, including prerelease", () => {
  const prerelease = parsePinnedInstall("pi install npm:pi-baton@0.9.2-beta.1");
  assert.deepEqual(prerelease && { name: prerelease.packageName, version: prerelease.version }, {
    name: "pi-baton",
    version: "0.9.2-beta.1",
  });
  assert.equal(
    parsePinnedInstall("pi install npm:pi-baton@0.9.2-rc.1+build.5")?.version,
    "0.9.2-rc.1+build.5",
  );

  // A truncated capture would probe the stable version instead of the copied
  // prerelease, so the checker could pass while the command fails.
  assert.notEqual(parsePinnedInstall("pi install npm:pi-baton@0.9.2-beta.1")?.version, "0.9.2");
});

test("pinned install verdict rejects a package-name mismatch and unlabeled 404s", () => {
  const manifest = { name: "pi-baton", version: "0.9.3" };

  // A different published package at the same version must not validate the pin.
  assert.deepEqual(
    evaluatePinnedInstall({
      readme: "pi install npm:some-other-package@0.9.2",
      manifest,
      status: 200,
    }).reason,
    "name-mismatch",
  );

  // A pinned version that does not resolve, with no unpublished label, is a
  // failure even when a neighbouring version is labeled unpublished.
  const readmePinPublished = [
    "pi install npm:pi-baton@0.9.2",
    "",
    "The next release, `0.9.3`, is **not yet published**.",
  ].join("\n");
  assert.deepEqual(
    evaluatePinnedInstall({ readme: readmePinPublished, manifest, status: 404 }),
    { ok: false, reason: "unpublished-unspecified", pinned: { packageName: "pi-baton", version: "0.9.2", index: 0 } },
  );

  // A genuinely labeled unpublished pin still passes the documentation half.
  assert.equal(
    evaluatePinnedInstall({
      readme: "pi install npm:pi-baton@0.9.3\n\n`0.9.3` is not yet published.",
      manifest,
      status: 404,
    }).reason,
    "labeled-unpublished",
  );

  // An unexpected status (auth, 5xx) is never a pass.
  assert.equal(
    evaluatePinnedInstall({ readme: "pi install npm:pi-baton@0.9.2", manifest, status: 403 }).ok,
    false,
  );
});

test("README release section does not claim a merged version bump publishes itself", () => {
  // docs/release.md and the release workflows require an explicit,
  // maintainer-controlled action; README must not promise an automatic release,
  // because that claim is what makes an unpublished pinned example look
  // installable.
  assert.doesNotMatch(readme, /version bumps? trigger auto-release/i);
  assert.match(readme, /does \*\*not\*\* release or publish it/);

  // The release paths documented in docs/release.md and publish.yml must all be
  // described, because naming only auto-release.yml is too narrow a contract.
  for (const path of [
    /\.github\/workflows\/auto-release\.yml/,
    /`v\*\.\*\.\*` tag/,
    /GitHub Release/,
    /\.github\/workflows\/publish\.yml/,
  ]) {
    assert.match(readme, path, `README should document the release path ${path}`);
  }

  // The pinned install example stays in place. Its version is checked through the
  // shared contract above rather than a fixed literal, so advancing the pin after a
  // release does not break the test.
  assert.ok(parsePinnedInstall(readme), "README should keep a pinned install example");
});

test("README quick start documents terminal run fallback for /baton:status", () => {
  assert.match(readme, /\/baton:status\s+show the active run summary, or the most recent finished run/);
});

test("README and workflow guide distinguish /baton:history from /baton:inspect", () => {
  assert.match(readme, /Use `\/baton:history` to find a recent completed or failed run[\s\S]*use `\/baton:inspect` to choose one/);
  assert.match(workflowsGuide, /`\/baton:history` to find a run; use `\/baton:inspect` to understand its structured step results/);
});

test("ROADMAP next planned version matches package version", async () => {
  const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
  const match = roadmap.match(/Next planned \| \*\*(\d+\.\d+\.\d+)\*\*/);

  assert.ok(match, "ROADMAP should document the next planned package version");
  assert.equal(match[1], packageJson.version);
});

test("release workflow stays behind explicit maintainer dispatch, not a main version bump push", () => {
  assert.match(contributing, /explicitly dispatches the release workflow on `main`/);
  assert.match(autoReleaseWorkflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(autoReleaseWorkflow, /^\s+push:/m);
  assert.match(autoReleaseWorkflow, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(autoReleaseWorkflow, /git tag --list 'v\[0-9\]\*' --sort=-version:refname/);
  assert.match(autoReleaseWorkflow, /git show "\$\{PREVIOUS_TAG\}:package\.json"/);
  assert.doesNotMatch(autoReleaseWorkflow, /git rev-parse HEAD\^/);
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
  const ciStatusMatch = roadmap.match(/typecheck \+ (\d+) tests \+ actual Pi SDK smoke \+ `npm pack --dry-run`/);

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
    /### 0\.9\.0 — Run lifecycle UX[\s\S]*?\/baton:history.*\[S-113\]/,
  );
});

test("ROADMAP marks shipped workflow authoring guide seed as done", async () => {
  const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
  const authoringGuide = await readFile(
    new URL("../docs/workflows.md", import.meta.url),
    "utf8",
  );

  assert.match(authoringGuide, /^# Custom workflow authoring/m);
  assert.match(authoringGuide, /## Step kinds/);
  assert.match(authoringGuide, /## Transitions/);
  assert.match(authoringGuide, /## Review contract/);
  assert.match(authoringGuide, /## `iteration_cap`/);
  assert.match(authoringGuide, /## Model overrides/);
  assert.match(authoringGuide, /## Agent discovery order/);
  assert.match(readme, /\[`docs\/workflows\.md`\]\(docs\/workflows\.md\)/);
  assert.match(roadmap, /### S-109 — Authoring guide for custom workflows `\[done\]`/);
  assert.doesNotMatch(roadmap, /### S-109 — Authoring guide for custom workflows `\[backlog\]`/);
  const s109 = roadmap.match(/<a id="s-109"><\/a>[\s\S]*?(?=\n---)/)?.[0];
  assert.ok(s109);
  assert.equal((s109.match(/^- \[x\]/gm) ?? []).length, 3);
  assert.doesNotMatch(s109, /^- \[ \]/m);
});

test("ROADMAP lists at least three ready maintenance seed candidates", async () => {
  const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
  const readySeeds = roadmap.match(/^### S-\d+ — .* `\[ready\]`.*$/gm) ?? [];

  assert.ok(readySeeds.length >= 3, "ROADMAP should list at least three ready maintenance seeds");
  for (const seed of readySeeds) {
    assert.match(seed, /`(S|M|L)`/, "each ready seed should declare a size");
  }
});
