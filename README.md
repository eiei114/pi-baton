# Pi Baton

<p align="center">
  <img src="./assets/pi-baton-icon-512.png" alt="Pi Baton icon" width="192" height="192" />
</p>

[![CI](https://github.com/eiei114/pi-baton/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-baton/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-baton/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-baton/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-baton.svg)](https://www.npmjs.com/package/pi-baton)
[![npm downloads](https://img.shields.io/npm/dm/pi-baton.svg)](https://www.npmjs.com/package/pi-baton)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)

> Run YAML-defined review loops in Pi with per-step model switching and isolated step context.

## What this is

Pi Baton is a Pi-native workflow baton runner. Define `implement → review → fix` loops in YAML, and let Pi Baton execute them with automatic baton handoff between isolated subagent steps.

## Features

- **Per-step model switching** — fast model for implement, strong model for review
- **Isolated step context** — no shared conversation pollution between steps
- **Structured review contract** — `accept`/`reject` with mandatory findings or acceptance notes
- **Live progress widget** — see which step is running, its agent, and judgment in real time

## Install

Install the published npm package with Pi:

```bash
pi install npm:pi-baton
```

Pin a specific version when you want reproducible installs:

```bash
pi install npm:pi-baton@0.7.1
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:pi-baton -l
```

Or install from GitHub:

```bash
pi install git:github.com/eiei114/pi-baton
```

Try it without permanently installing:

```bash
pi -e npm:pi-baton
```

## Quick start

Try this package locally from a clone of this repository:

```bash
pi -e .
```

Then run:

```txt
/baton:new        create a workflow scaffold
/baton:start      choose workflow + task brief → idle run
/baton:run        execute run to terminal state (with live widget)
/baton:status     show the active run summary
```

The builtin `Default Review Loop` workflow (implement → review → fix) works out of the box — no agent setup required.

## Prerequisites

Pi Baton ships builtin `worker` and `reviewer` subagents under `agents/`. They work with your current Pi model.

To override with custom agents, place `.md` files under:

```
.pi/agents/worker.md
.pi/agents/reviewer.md
```

Discovery order: project `.pi/agents/` → user `~/.pi/agent/agents/` → pi-baton builtin.

## Workflow authoring

```txt
/baton:new
```

Pick a name and a scaffold from `default-review-loop` is written to `.pi/baton/workflows/` and opened in editor. The scaffold includes `<your-fast-model>` / `<your-strong-model>` placeholders for step-level model overrides.

### Workflow YAML reference

```yaml
name: My Review Loop
iteration_cap: 5
steps:
  implement:
    agent: worker
    model: openai/gpt-5.4        # optional: fast model
    prompt: work prompt
    next: review
  review:
    agent: reviewer
    model: anthropic/claude-opus-4-5  # optional: strong model
    prompt: review prompt
    on_accept: _complete         # or a step name
    on_reject: fix
  fix:
    agent: worker
    model: openai/gpt-5.4
    prompt: fix prompt
    next: review
```

- `on_accept: _complete` ends the run.
- `iteration_cap` prevents infinite review loops — the run fails at the cap.
- Review agents must return `accept`/`reject` with findings or acceptance notes.

## Package contents

| Path | Purpose |
|---|---|
| `extensions/` | Slash-command entrypoints (`/baton:new`, `/baton:start`, `/baton:run`, `/baton:status`) |
| `lib/` | Workflow parser, run engine, subagent runner, review contract, UI widget |
| `agents/` | Builtin `worker` and `reviewer` subagent definitions |
| `workflows/` | Builtin `default-review-loop.yaml` |
| `assets/` | README / package branding assets |
| `docs/` | Release and maintainer docs |

## Development

```bash
npm install
npm run ci
```

## Release

This package uses npm Trusted Publishing with GitHub Actions OIDC — no `NPM_TOKEN` is required.

```bash
npm version patch
git push
```

On `main`, version bumps trigger auto-release and publish workflows. See [`docs/release.md`](docs/release.md) for setup details.

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-baton
- GitHub: https://github.com/eiei114/pi-baton
- Issues: https://github.com/eiei114/pi-baton/issues

## License

MIT
