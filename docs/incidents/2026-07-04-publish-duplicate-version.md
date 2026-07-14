# Incident — 2026-07-04 `Publish to npm` failed with duplicate-version E403

> Status: **investigation report only.** No release workflow, package version,
> CHANGELOG, npm registry state, or release was changed to produce this document.
> Correction options below are proposals for a separate follow-up issue.

## Summary

The `Publish to npm` run
[28704529442](https://github.com/eiei114/pi-baton/actions/runs/28704529442)
(`v0.7.2`, dispatched 2026-07-04) failed at the final `npm publish` step with:

```text
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/pi-baton
npm error 403 You cannot publish over the previously published versions: 0.7.2.
```

**Root cause (classification: trigger/configuration):** a version-bump push to
`main` fans out into **two concurrent `publish.yml` runs** for the same version,
keyed by **different concurrency groups** so they are not serialized. The
"Skip already published version" guard is a non-atomic check-then-publish
(TOCTOU) and was defeated by ~11s of npm registry propagation latency, so the
losing run reached `npm publish` after the winning run had already published
`0.7.2`.

This is **not** an authentication / Trusted Publishing failure (OIDC provenance
was signed successfully) and **not** a duplicate-version-at-dispatch (the version
was unpublished when the run started).

**Impact:** none on the registry. `pi-baton@0.7.2` is correctly published and is
`dist-tags.latest`. The failed run is a harmless duplicate that lost the race.

## Evidence

### Failed run

| Field | Value |
| --- | --- |
| Run | [`Publish to npm` · 28704529442](https://github.com/eiei114/pi-baton/actions/runs/28704529442) |
| Workflow | `.github/workflows/publish.yml` |
| Event / trigger | `workflow_dispatch` |
| Ref checked out | `v0.7.2` (tag), via `actions/checkout@v7` (`ref: v0.7.2`) |
| Package | `pi-baton@0.7.2` |
| Started / failed | 2026-07-04T11:18:38Z / 2026-07-04T11:19:11Z |
| Failed step | `Publish to npm` (`npm publish --access public`) |
| Conclusion | failure, exit code 1 |

Step-by-step status (from the run): `Set up job`, `Checkout`, `Setup Node.js`,
`Ensure npm supports trusted publishing`, `Install dependencies`, `Validate
package`, `Skip already published version` all **passed**; `Publish to npm`
**failed**.

Failure output excerpt (from the failed step log):

```text
npm notice 📦  pi-baton@0.7.2
...
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
npm notice publish Signed provenance statement with source and build information from GitHub Actions
npm notice publish Provenance statement published to transparency log: https://search.sigstore.dev/?logIndex=2069634820
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/pi-baton - You cannot publish over the previously published versions: 0.7.2.
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-07-04T11_19_08_227Z-debug-0.log
##[error]Process completed with exit code 1.
```

Note: provenance **was** signed (Trusted Publishing / OIDC worked); the failure is
the publish PUT, not authentication.

### Who dispatched it (trigger chain)

The `workflow_dispatch` run was dispatched by the `Auto Release` workflow, not by
a human clicking "Run workflow" in the UI:

- PR #25 (`chore/sponsor-funding-patch-20260704`) merged to `main` at
  **11:18:31Z**, bumping `package.json` to `0.7.2`.
- The merge push fired two workflows on `main`:
  - [`Publish to npm` · 28704526901](https://github.com/eiei114/pi-baton/actions/runs/28704526901)
    (event `push`, ref `refs/heads/main`) — **success**.
  - [`Auto Release` · 28704526903](https://github.com/eiei114/pi-baton/actions/runs/28704526903)
    (event `push`, ref `refs/heads/main`) — **success**.
- `Auto Release` detected the version bump, created tag `v0.7.2` and the GitHub
  Release (11:18:35–37Z), then ran its final step:
  `gh workflow run publish.yml --ref v0.7.2 -f ref=v0.7.2`
  (log: `Run TAG="v0.7.2"` → `gh workflow run publish.yml --ref "$TAG" -f ref="$TAG"`).
- That dispatch produced the failed run **28704529442** at **11:18:38Z**.

So a single version-bump merge produced **two** `publish.yml` runs for `0.7.2`:
one from the `push` trigger (main) and one from `Auto Release`'s explicit
`workflow_dispatch` (v0.7.2). This double-trigger is consistent with the design
documented in [`docs/release.md`](../release.md) (the push trigger and the
auto-release handoff both fire; the tag/`release.published` triggers are
unreliable for `GITHUB_TOKEN`-created tags, which is why auto-release dispatches
explicitly).

### Race timeline (all times UTC)

| Time | Run | Event |
| --- | --- | --- |
| 11:18:31 | 28704526901 / 28704526903 | merge push to `main` fires `publish.yml` (push) + `auto-release.yml` |
| 11:18:35–37 | 28704526903 | `Auto Release` creates tag `v0.7.2`, release, dispatches `publish.yml` |
| 11:18:38 | 28704529442 | dispatched `publish.yml` (v0.7.2) starts — the failed run |
| 11:18:52 | 28704526901 | skip guard says `Publishing pi-baton@0.7.2.` (0.7.2 not yet on npm) |
| **11:18:56** | **28704526901** | **`+ pi-baton@0.7.2` — push run publishes 0.7.2** |
| 11:19:07 | 28704529442 | skip guard runs `npm view pi-baton@0.7.2 version` → **404** (skip=false) |
| 11:19:08 | 28704529442 | prints `Publishing pi-baton@0.7.2.`, starts `npm publish` |
| 11:19:11 | 28704529442 | `E403` — cannot publish over `0.7.2` (already published 11s earlier) |

The decisive detail: the failed run's `npm view pi-baton@0.7.2 version` returned
**404 at 11:19:07**, ~11 seconds **after** the push run actually published
`0.7.2` at 11:18:56. The skip guard therefore proceeded, and `npm publish` hit
the real-time conflict.

### npm public state (read-only)

```console
$ npm view pi-baton version dist-tags.latest
0.7.2
{ latest: '0.7.2' }

$ npm view pi-baton time --json
{
  "0.7.2": "2026-07-04T11:18:56.171Z",
  ...
}
```

The `0.7.2` timestamp was published by the winning push run (28704526901).

`pi-baton@0.7.2` is present, is `dist-tags.latest`, and was published at
11:18:56Z — i.e. by the parallel push run (28704526901), not by the failed run.
Published versions: `0.2.2, 0.2.3, 0.3.0, 0.4.0, 0.5.0, 0.6.0, 0.7.0, 0.7.1,
0.7.2`. No registry correction is needed.

## Cause classification

**Trigger / configuration** — specifically a concurrent-duplicate-publish race:

1. **Double trigger for one version bump.** A `package.json` version bump on
   `main` fires `publish.yml` twice: once via the `push` (branches: `main`,
   paths: `package.json`) trigger, and once via `auto-release.yml`'s explicit
   `gh workflow run publish.yml --ref "$TAG" -f ref="$TAG"`.
2. **Concurrency groups do not collide.** `publish.yml` uses
   `group: npm-publish-${{ github.event.inputs.ref || github.ref }}`:
   - push run → `npm-publish-refs/heads/main`
   - dispatch run → `npm-publish-v0.7.2`
   
   Different keys ⇒ `concurrency` does not serialize the two runs; they execute
   in parallel for the same version.
3. **Non-atomic idempotency guard (TOCTOU).** "Skip already published version"
   runs `npm view <name>@<version>` and, on 404, proceeds to `npm publish` in a
   later step. There is no lock between check and publish, and `npm view` reads
   registry metadata that lags the actual publish (here by ~11s). The losing run
   therefore sees "not published", then loses the race to `npm publish`.

Explicitly **not** the cause:

- **Duplicate-version at dispatch.** No — `0.7.2` was not on npm when the run was
  dispatched (11:18:38) or when its skip guard ran (the guard returned 404).
- **Trusted Publishing / authentication.** No — provenance was signed
  successfully, `permissions.id-token: write` is set, `registry-url` is correct,
  and no `NPM_TOKEN` is used (Trusted Publishing). Auth was healthy.

## Reproducible non-publish check

These commands are **read-only** — they do not publish, rerun the workflow, or
touch the registry/versions. They reproduce the diagnosis from a clean checkout.

```bash
# 1) Confirm 0.7.2 is published and is latest (read-only registry query).
npm view pi-baton version                # -> 0.7.2
npm view pi-baton dist-tags.latest       # -> 0.7.2
npm view pi-baton@0.7.2 time --json      # -> "0.7.2": "2026-07-04T11:18:56.171Z"

# 2) Show the two concurrent publish runs produced by one version-bump merge.
#    (--created takes a date, not a full timestamp.)
gh run list --repo eiei114/pi-baton --workflow "Publish to npm" \
  --created 2026-07-04 --limit 10 \
  --json databaseId,event,headBranch,conclusion,createdAt
# Expect both:
#   28704526901  push             main    success   (published 0.7.2)
#   28704529442  workflow_dispatch v0.7.2 failure   (E403 duplicate)

# 3) Show the dispatch origin (Auto Release triggered the failed run).
gh run view 28704526903 --repo eiei114/pi-baton --log \
  | grep -E 'gh workflow run publish.yml|released=true|TAG="v0.7.2"'

# 4) Prove the two runs had DIFFERENT concurrency groups (so they raced).
#    publish.yml: group: npm-publish-${{ github.event.inputs.ref || github.ref }}
#    push run     -> github.event.inputs.ref is unset, github.ref = refs/heads/main
#                    => "npm-publish-refs/heads/main"
#    dispatch run -> github.event.inputs.ref = "v0.7.2"  (-f ref=v0.7.2)
#                    => "npm-publish-v0.7.2"
node -e '
const g = (ref, inputRef) => `npm-publish-${inputRef || ref}`;
console.log("push    :", g("refs/heads/main", undefined));
console.log("dispatch:", g("refs/tags/v0.7.2", "v0.7.2"));
console.log("collide :", g("refs/heads/main", undefined) === g("refs/tags/v0.7.2", "v0.7.2"));
'
# => push    : npm-publish-refs/heads/main
# => dispatch: npm-publish-v0.7.2
# => collide : false
```

## Minimal safe correction options

None of these are applied here — they are candidates for a **separate
correction issue** (release/publish workflows remain human-owned). Listed from
smallest/safest to largest behavior change.

- **Option A — make `npm publish` idempotent (recommended, smallest).** In the
  `Publish to npm` step, treat the specific "cannot publish over the previously
  published versions" `E403` as success instead of failure. This makes the
  workflow resilient to the double-trigger race regardless of concurrency or
  propagation lag. Scope the match to that exact message so genuine permission
  errors still fail. Sketch (not applied):

  ```bash
  set +e
  npm publish --access public 2>&1 | tee /tmp/publish.log
  status=${PIPESTATUS[0]}
  set -e
  if [ "$status" -ne 0 ] && grep -Eq 'cannot publish over the previously published versions' /tmp/publish.log; then
    echo "Version already published; treating publish as success."
    exit 0
  fi
  exit "$status"
  ```

- **Option B — serialize the two runs via one concurrency group.** Replace the
  ref-keyed group with a single constant group (e.g. `group: npm-publish`) and
  keep `cancel-in-progress: false`, so the push run and the auto-release dispatch
  queue instead of racing. Best combined with Option A, since the skip guard is
  still non-atomic. Avoid `cancel-in-progress: true` here — cancelling mid-publish
  risks a partial publish.

- **Option C — collapse to a single handoff path.** Remove the `push`
  (`branches: [main]`, `paths: [package.json]`) trigger from `publish.yml` so a
  version bump publishes only via `auto-release.yml`'s explicit dispatch (the path
  `docs/release.md` already describes as the reliable one). Largest behavior
  change; needs validation that the manual tag / `release.published` /
  `workflow_dispatch` entry points still cover intended cases.

## Out of scope for this issue (enforced)

Per the issue brief, this slice intentionally does **not**: edit release/publish
workflows, publish a package, rerun the workflow, change the package version, or
update the CHANGELOG. A safe correction should be tracked in a follow-up issue.
