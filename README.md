# Pi Baton

[![CI](https://github.com/eiei114/pi-baton/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-baton/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-baton.svg)](https://www.npmjs.com/package/pi-baton)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Run YAML-defined review loops in Pi with per-step model switching and isolated step context.

## What this is

Pi Baton is a Pi-native workflow baton runner. Define `implement → review → fix` loops in YAML, and let Pi Baton execute them with automatic baton handoff between isolated subagent steps.

- **Per-step model switching** — fast model for implement, strong model for review
- **Isolated step context** — no shared conversation pollution between steps
- **Structured review contract** — `accept`/`reject` with mandatory findings or acceptance notes
- **Live progress widget** — see which step is running, its agent, and judgment in real time

## Install

```bash
pi install npm:pi-baton
```

Project-local:

```bash
pi install npm:pi-baton -l
```

GitHub:

```bash
pi install git:github.com/eiei114/pi-baton
```

## Quick start

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
| `extensions/` | 4 slash-command entrypoint (`/baton:new`, `/baton:start`, `/baton:run`, `/baton:status`) |
| `lib/` | Workflow parser, run engine, subagent runner, review contract, UI widget |
| `agents/` | Builtin `worker` and `reviewer` subagent definitions |
| `workflows/` | Builtin `default-review-loop.yaml` |
| `docs/` | Release docs |

## Development

```bash
npm install
npm run ci
```

## License

MIT
