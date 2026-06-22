# Roadmap

> Living planning doc for **pi-baton**. The weekly maintenance seed planner reads the
> [Maintenance seed backlog](#maintenance-seed-backlog) section to spawn 30–90 minute
> micro tasks. Edit this file as the project evolves; it is the single source of truth
> for "what's next."

## Current release status

| Field | Value |
|---|---|
| Latest release | **0.4.0** (2026-06-22) |
| Next planned | **0.5.0** — polish & cleanup release |
| Stability | Early / pre-1.0; surface (`/baton:*` commands + YAML schema) is stabilizing |
| CI | `npm run ci` green (typecheck + 36 tests + `npm pack --dry-run`) |
| Security | `npm audit` reports 4 high-severity advisories (transitive, via `@earendil-works/pi-coding-agent`) — see seed [S-103](#s-103) |
| npm publishing | npm Trusted Publishing (OIDC), no `NPM_TOKEN` |

Release cadence so far: 0.2.0 → 0.2.3 → 0.3.0 → 0.4.0 across ~9 days. The project is in
rapid iteration; the near-term focus is **consolidation and cleanup** before adding new
surface area.

## What pi-baton is

Pi Baton is a Pi-native **workflow baton runner**. Define `implement → review → fix`
loops in YAML; pi-baton executes them with automatic baton handoff between isolated
subagent steps, per-step model switching, a structured `accept`/`reject` review
contract, and a live progress widget.

### Surface map

| Path | Role |
|---|---|
| `extensions/index.ts` | 4 slash commands: `/baton:new`, `/baton:start`, `/baton:run`, `/baton:status` |
| `lib/` | Workflow parser, schema validation, run engine, run store, subagent runner, review contract, model routing, UI widget, status formatter |
| `agents/` | Builtin `worker` and `reviewer` subagent definitions |
| `workflows/default-review-loop.yaml` | Builtin review-loop workflow |
| `tests/*.test.mjs` | 36 tests (engine, store, schema, discovery, scaffold, widget, status, agents) |

### Architecture in one paragraph

A **workflow** (`WorkflowDefinition`) is a graph of steps discovered from
`.pi/baton/workflows/*.yaml` plus builtin package workflows. `/baton:start` creates an
**idle run** (`RunManifest`) and writes an active-run pointer under `.pi/baton/`.
`/baton:run` walks the step graph via `runContinuous`, executing each step through an
isolated `subagent-runner` call, enforcing the review contract (`accept`/`reject` with
findings/acceptance notes), persisting step records + raw outputs, and updating the run
state until `on_accept: _complete` or `iteration_cap` is hit. Terminal runs free the
active-run guard so a new run can start.

## Near-term direction (next 2–3 releases)

### 0.5.0 — Polish & cleanup (current focus)

The template-bootstrap era left dead files and misleading docs that ship to every npm
consumer. This release clears them and tightens the published surface.

- Remove leftover template scaffolding that is neither shipped nor referenced.
- Stop shipping stale bootstrap docs to npm consumers.
- Close transitive dependency advisories and merge the open dependabot queue.
- Round out small UX gaps in `/baton:status` for terminal runs.

### 0.6.0 — Workflow authoring depth

Make authoring custom loops easier and more demonstrable.

- A second builtin workflow showcasing a non-review (linear, or multi-stage) shape.
- Authoring guide in `docs/` (currently only the YAML reference in README exists).
- Optional: per-step `model` resolution test matrix / clearer missing-model errors.

### 0.7.0 — Observability & resilience

- `/baton:cancel` to stop a runaway run cleanly (today only `iteration_cap` bounds it).
- Run history / listing (past runs under `.pi/baton/runs/` are unreadable after they go terminal).
- Timeout / abort propagation through the subagent runner.

> Releases are driven by merged work, not calendar dates. Items move up or down as
> seeds land; this section is a directional guide, not a commitment.

---

## Maintenance seed backlog

Each entry below is a **candidate maintenance seed** — a bounded, independently
shippable micro task. Seeds are sized **S** (≈30 min), **M** (≈45–60 min),
**L** (≈75–90 min). The weekly seed planner may pick any `ready` seed; pick top-down
when there is no other signal.

### S-101 — Delete leftover template resource dirs `[ready]` `S` `cleanup`

**What.** Remove `prompts/example.md`, `themes/example-theme.json`, and
`skills/example-skill/`. These are leftover template scaffolding.

**Why.** They are not in `package.json` `files`, are referenced by no code
(`grep` confirms zero references), and mislead contributors into thinking pi-baton ships
prompts/themes/skills. They also keep `docs/examples.md` (see [S-102](#s-102)) alive as a
plausible-looking but broken doc.

**Acceptance criteria.**
- [ ] `prompts/`, `themes/`, `skills/` removed (or each dir removed if it holds only the example).
- [ ] `npm run ci` still green.
- [ ] `npm pack --dry-run` output unchanged (they were never shipped — confirms no regression).
- [ ] CHANGELOG entry under `[Unreleased]` / next version.

**Route hint.** Direct, no-action-safe cleanup. `pr_required`.

---

### S-102 — Replace stale `docs/examples.md` `[ready]` `M` `docs`

**What.** `docs/examples.md` describes `/template-hello`, `template_greet`,
`extensions/hello.ts`, and `lib/greeting.ts` — **none of which exist in pi-baton**. It is
copy-pasted from the package template and was never adapted. Either rewrite it around the
real `/baton:*` commands + `default-review-loop.yaml`, or delete it and fold any useful
example into README.

**Why.** This doc ships to every npm consumer (it is under the shipped `docs/` glob) and
describes commands that do not exist. It is the most user-visible defect in the repo.

**Acceptance criteria.**
- [ ] No references to `template-hello`, `template_greet`, `extensions/hello.ts`, or `lib/greeting.ts` remain.
- [ ] Either: (a) rewritten `docs/examples.md` shows a real end-to-end run using `default-review-loop.yaml`, or (b) deleted with a one-line README pointer to the existing "Quick start" + "Workflow YAML reference" sections.
- [ ] `npm run ci` green; `npm pack --dry-run` reflects the decision.

**Route hint.** Direct. `pr_required`.

---

### S-103 — Drop template bootstrap docs from the shipped package `[ready]` `M` `docs` `cleanup`

**What.** `docs/github-template.md`, `docs/repository-settings.md`,
`docs/typescript.md`, and `docs/template-checklist.md` are all self-labeled
"Template bootstrap doc. Delete or merge once setup is done." They are **shipped to npm
consumers** today because `docs/` is in `package.json` `files`. Either remove the files,
or (if any retained value) stop shipping them.

**Why.** npm consumers of pi-baton do not need instructions for *generating a new repo
from the template*. The template's own `docs/template-checklist.md` explicitly instructs
deleting or merging these post-setup. Shipping them is noise on every install.

**Acceptance criteria.**
- [ ] Decision recorded: delete vs. keep-but-unship.
- [ ] If deleted: README `Package contents` / docs nav updated to drop dead links.
- [ ] If kept: `package.json` `files` narrowed so `docs/` ships only `release.md` (and the `examples.md` outcome of [S-102](#s-102)); `npm pack --dry-run` confirms.
- [ ] CHANGELOG entry.

**Route hint.** Direct. Coordinate with [S-102](#s-102) (same area). `pr_required`.

---

### S-104 — Resolve `npm audit` high-severity advisories `[ready]` `M` `deps` `security`

**What.** `npm audit` reports 4 high-severity advisories in transitive deps
(`undici`, `ws`, `protobufjs`) pulled in via `@earendil-works/pi-coding-agent`. These are
`peerDependencies`/`devDependencies` for pi-baton, so they do not ship to *pi-baton's*
runtime consumers, but they affect the dev/CI environment and the published provenance.

**Why.** Security hygiene; keeps the dev toolchain current and the `npm audit` badge clean.

**Acceptance criteria.**
- [ ] `npm audit` reports 0 high/critical (or remaining items are documented as upstream-blocked with a tracking note).
- [ ] `npm install && npm run ci` green.
- [ ] If a `npm audit fix --force` is needed, the version bump is intentional and CHANGELOG'd.

**Route hint.** Direct. May overlap with [S-105](#s-105). `pr_required`.

---

### S-105 — Triage and merge the open dependabot queue `[ready]` `S` `deps`

**What.** 8 dependabot branches are open (`pi-ai`, `pi-coding-agent`, `typebox`,
`types/node`, `actions/checkout` major bump to v7). Review each for breaking changes,
merge or close, and collapse where they conflict.

**Why.** The queue has grown faster than it has been cleared; major bumps (e.g.
`actions/checkout-7`) can rot if left.

**Acceptance criteria.**
- [ ] Each open dependabot PR is either merged or closed with a recorded reason.
- [ ] Post-merge `npm run ci` green on `main`.
- [ ] If `peerDependencies` ranges widen, note the minimum supported Pi version.

**Route hint.** Direct. `pr_required` (merging the dependabot PRs is the PR).

---

### S-106 — `/baton:status` for terminal runs `[ready]` `M` `ux`

**What.** Once a run reaches `completed`/`failed`, `loadActiveRun` returns `null`, so
`/baton:status` shows `NO_ACTIVE_RUN_MESSAGE` — the user cannot inspect the just-finished
run's outcome, last step, or run directory from the command surface.

**Why.** After `/baton:run` completes, the natural next action is `/baton:status` to read
the result; today that says "no active run," which reads as a failure.

**Acceptance criteria.**
- [ ] `/baton:status` after a terminal run shows the most recent run's summary (state, last step, iteration, run directory) with a clear "this run is finished" framing, rather than the no-active-run message.
- [ ] Behavior when no run has ever existed is unchanged (still the no-active-run message).
- [ ] New/updated test in `tests/status.test.mjs` covering the terminal-run path.
- [ ] CHANGELOG entry.

**Route hint.** Direct implementation seed. `pr_required`.

---

### S-107 — Remove dead `clearActiveRunPointer` (or wire it up) `[ready]` `S` `cleanup`

**What.** `clearActiveRunPointer` in `lib/run-store.ts` is exported but **never called**.
Also note it writes `{ runId: null }` while `readActiveRunPointer` does not treat a null
`runId` as "no pointer" (it currently works only because the downstream `readRunManifest`
throws and is caught). Either delete it, or wire it into a real reset path and harden the
read.

**Why.** Dead code + a latent null-handling sharp edge. Small, but exactly the kind of
thing that bites later.

**Acceptance criteria.**
- [ ] Either removed (with grep confirming no callers), OR called from a documented path (e.g. a future `/baton:cancel`) and `readActiveRunPointer` treats `{ runId: null }` as no-pointer.
- [ ] `npm run ci` green.

**Route hint.** Direct. Pairs naturally with the future `/baton:cancel` work (0.7.0). `pr_required`.

---

### S-108 — Add a second builtin workflow (non-review shape) `[backlog]` `L` `feature`

**What.** Add a second workflow under `workflows/` that demonstrates a shape other than
the review loop — e.g. a pure linear `draft → refine → polish` pipeline, or a
two-reviewer gauntlet — so users see that pi-baton is not hard-wired to one loop.

**Why.** The README sells "per-step model switching" and "isolated step context" as
general capabilities, but only the review loop ships. A second example turns the claim
into proof and lowers the authoring barrier.

**Acceptance criteria.**
- [ ] New `workflows/*.yaml` with a distinct step graph, valid against `workflow-schema`.
- [ ] Discovered and ordered correctly by `workflow-discovery` (add/extend a test).
- [ ] Documented in README `Workflow authoring` or a new `docs/workflows.md`.
- [ ] `npm run ci` green; CHANGELOG entry.

**Route hint.** Feature seed — promote from `backlog` once 0.5.0 cleanup lands. `pr_required`.

---

### S-109 — Authoring guide for custom workflows `[backlog]` `M` `docs`

**What.** README has a YAML reference but no walkthrough for authoring a custom loop
(choosing agents, when to use `on_accept` vs `next`, how `iteration_cap` interacts with
`on_reject`, model override conventions). Add a focused `docs/workflows.md`.

**Why.** Lowers the barrier to the core customization story; complements [S-108](#s-108).

**Acceptance criteria.**
- [ ] `docs/workflows.md` covers: step kinds, transitions, review contract, iteration cap, model overrides, agent discovery order.
- [ ] Cross-linked from README.
- [ ] No stale template content introduced.

**Route hint.** Docs seed. Promote alongside [S-108](#s-108). `pr_required`.

---

## Areas needing improvement (themes, not single seeds)

- **Published-surface hygiene.** The npm tarball should contain only what an *consumer*
  of pi-baton needs. Today it ships template bootstrap docs (see [S-103](#s-103)).
  Ongoing rule: when adding `docs/`, ask "would an installer of this package read this?"
- **Test coverage of the engine edge cases.** Core paths (review contract, run-state
  transitions, single-active-run guard) are covered; thinner areas include
  `iteration_cap` exhaustion messaging, abort/timeout propagation in
  `subagent-runner`, and the terminal-run status path ([S-106](#s-106)).
- **Run lifecycle beyond the active run.** Past runs are persisted under
  `.pi/baton/runs/` but unreadable from the command surface after going terminal. A
  future `/baton:history` or `/baton:cancel` (0.7.0) would address this.
- **Dependency freshness.** Keep the dependabot queue near-zero; pi-baton sits on top of
  fast-moving `@earendil-works/pi-*` packages and a major bump left to rot becomes a
  blocker (see [S-104](#s-104), [S-105](#s-105)).

## How to add a seed

1. Add an entry under [Maintenance seed backlog](#maintenance-seed-backlog) with a
   stable `S-###` id (next free number), a size (`S`/`M`/`L`), and a `ready`/`backlog`
   state.
2. Include **What / Why / Acceptance criteria / Route hint** so an agent can pick it up
   with no extra context.
3. Keep seeds 30–90 minutes. If a seed grows past that, split it.
4. When a seed ships, move it to a `## Shipped` log at the bottom (append-only) rather
   than deleting it — the history helps future planning.
