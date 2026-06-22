# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [0.5.0] - 2026-06-23

### Added

- `/baton:run` continuous run engine executes the active idle run through isolated subagent steps to a terminal state.
- Step records persist under `.pi/baton/runs/<run>/steps/` and raw outputs under `outputs/`.
- Terminal run summaries report the failing step as `last step` when step execution fails.

### Changed

- Expanded `run-engine` tests for step/output persistence, state transitions, and failure `last step` reporting.

## [0.4.0] - 2026-06-22

### Added

- `/baton:start` creates an idle run from workflow selection and a task brief without starting execution.
- `/baton:status` reports workflow name, task brief, last/current step, run state, iteration count, and run directory.
- Single active run guard blocks a second `/baton:start` and points users to `/baton:status` or `/baton:run`.
- Run manifests persist under `.pi/baton/runs/` with an active-run pointer.
- Expanded workflow schema validation tests covering required fields, linear `next` transitions, review `on_accept` / `on_reject` branches, and invalid YAML handling at discovery time.

### Changed

- Workflow selection display names continue to come from YAML `name`; invalid or incomplete workflow documents now fail with explicit validation errors during `/baton:start` and `/baton:run` discovery.

## [0.3.0] - 2026-06-18

### Added

- `/baton:new` re-prompts for a workflow name when the derived filename collides with an existing scaffold.
- Tests for lazy `.pi/baton/workflows/` creation and kebab-case filename derivation.

### Changed

- Workflow discovery keeps user-defined `.pi/baton/workflows/*.yaml` entries ahead of builtin package workflows in selection order.

## [0.2.3] - 2026-06-13

### Added

- README header icon and packaged `assets/pi-baton-icon-512.png` branding asset.

### Changed

- `assets/` is now included in the published package.

## [0.2.2] - 2026-06-13

### Added

- Live Baton run widget above the editor during `/baton:run`, showing workflow, brief, active step, agent, judgment, and step checklist.
- Footer status line (`baton: implement`, `baton: review`, etc.) while a run is in progress.

## [0.2.1] - 2026-06-13

### Fixed

- Ship builtin `worker` and `reviewer` subagent definitions so `default-review-loop` runs without pre-created `.pi/agents/` files.
- Validate required workflow agents during `/baton:start` and `/baton:run` with clearer missing-agent errors.

## [0.2.0] - 2026-06-13

### Added

- `/baton:new`, `/baton:start`, `/baton:run`, and `/baton:status` command surface.
- Builtin `default-review-loop` workflow with `worker` / `reviewer` / `worker` agent mapping.
- YAML workflow discovery, inline validation, scaffold generation, and run persistence under `.pi/baton/`.
- Isolated subagent step execution with structured handoff, review contract enforcement, and per-step model routing.

## [0.1.2] - 2026-06-04

### Changed

- README and `docs/template-checklist.md` now follow the Pi OSS minimal-docs policy: `docs/` is optional, with explicit post-generation cleanup for template bootstrap docs.
- Template bootstrap docs (`github-template.md`, `repository-settings.md`, `typescript.md`) are labeled for delete-or-merge after setup.

## [0.1.1] - 2026-06-01

### Changed

- Publish workflow now supports npm publishing on merged package version bumps in addition to tags, releases, and manual dispatch.
- Publish workflow now installs a current npm CLI so npm Trusted Publishing OIDC is supported.
- CI and publish workflow commands no longer include literal trailing `\\n` text.

## [0.1.0] - YYYY-MM-DD

### Added

- Initial Pi package template.
- Example extension, Agent Skill, prompt, and theme.
- CI and npm Trusted Publishing workflow.
