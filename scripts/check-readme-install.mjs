#!/usr/bin/env node
/**
 * Read-only check that the pinned install example in README.md is installable.
 *
 * `tests/smoke.test.mjs` can only compare README against this tree's
 * package.json, so it stays green while a copied `pi install npm:pi-baton@x.y.z`
 * specifier is still unpublished (a version bump merged to `main` is not
 * published by itself; a maintainer-controlled release action is required, see
 * docs/release.md). This script closes that gap by asking the npm registry
 * whether the pinned version actually resolves.
 *
 * The decision itself lives in `readme-install-contract.mjs`
 * (`evaluatePinnedInstall`), so the offline tests exercise the same code path
 * that a 404 or a package-name mismatch takes here.
 *
 * The check needs network access, so it is a separate opt-in script and is not
 * part of `npm run ci`. It never publishes, tags or mutates the registry.
 *
 * Usage: npm run check:readme-install
 *   PI_BATON_REGISTRY overrides the registry origin (default https://registry.npmjs.org).
 * Exit codes: 0 = documented specifier is installable (or clearly labeled as not
 * yet published), 1 = the copied command would fail, 2 = the registry could not
 * be reached (explicit prerequisite failure, never a silent pass).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluatePinnedInstall, parsePinnedInstall } from "./readme-install-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const pinned = parsePinnedInstall(readme);
if (!pinned) {
  console.error("FAIL: README.md has no pinned `pi install npm:<name>@<version>` example");
  process.exit(1);
}

const { packageName, version: pinnedVersion } = pinned;
const rows = [
  `README pinned   : ${packageName}@${pinnedVersion}`,
  `package.json    : ${manifest.name}@${manifest.version}`,
];

// Reject a pin for another package before touching the network: the same version
// can exist for a different package, so a 200 would validate a command that
// installs the wrong package.
if (packageName !== manifest.name) {
  rows.push(
    `result          : FAIL, README pins ${packageName} but package.json is ${manifest.name}`,
    "action          : pin the package this repository publishes",
  );
  console.error(rows.join("\n"));
  process.exit(1);
}

const registry = (process.env.PI_BATON_REGISTRY ?? "https://registry.npmjs.org").replace(/\/+$/, "");
const url = `${registry}/${packageName}/${pinnedVersion}`;

let status;
try {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  status = response.status;
} catch (error) {
  console.error(rows.concat(`registry probe  : ${url} -> unreachable (${error.message})`, "result          : PREREQUISITE FAILURE, cannot confirm the pinned version").join("\n"));
  process.exit(2);
}

rows.push(`registry probe  : ${url} -> HTTP ${status}`);

const verdict = evaluatePinnedInstall({ readme, manifest, status });

if (verdict.ok) {
  rows.push(
    verdict.reason === "labeled-unpublished"
      ? "result          : OK, pinned version is unpublished and README labels it as not yet installable"
      : "result          : OK, the documented pinned install command resolves on npm",
  );
  console.log(rows.join("\n"));
  process.exit(0);
}

rows.push(`result          : FAIL, ${packageName}@${pinnedVersion} does not resolve on npm (HTTP ${status})`);
rows.push(
  pinnedVersion === manifest.version
    ? "action          : label the version as not yet published in README, or pin the newest published version"
    : "action          : pin the newest published version in README",
);
console.error(rows.join("\n"));
process.exit(1);
