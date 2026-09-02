# Custom workflow authoring

This guide walks through authoring a custom Pi Baton workflow YAML. For a compact field reference, see the [Workflow YAML reference](../README.md#workflow-yaml-reference) in the README.

## Where workflows live

| Location | Source | Notes |
|---|---|---|
| `.pi/baton/workflows/*.yaml` | user | Your custom workflows; listed first in `/baton:start` |
| `workflows/*.yaml` (package) | builtin | Shipped with pi-baton (`default-review-loop`, `two-stage-review-gauntlet`) |

Run `/baton:new` to scaffold a new file under `.pi/baton/workflows/`. The scaffold copies the default review loop and adds `<your-fast-model>` / `<your-strong-model>` placeholders on worker and reviewer steps.

The **first step key** in `steps:` is the entry step when a run starts.

## Step kinds

Every step requires `agent` and `prompt`. Pi Baton infers the step kind from its transition fields.

### Linear steps

Use `next` to move unconditionally to the next step. Linear steps are for implement, fix, draft, or any work that always proceeds forward.

```yaml
implement:
  agent: worker
  prompt: |
    Complete the task brief. End with a JSON summary block.
  next: review
```

### Review steps

Use `on_accept` and `on_reject` instead of `next`. Review steps gate progress on a structured judgment.

```yaml
review:
  agent: reviewer
  prompt: |
    Review the work. Return accept or reject using the JSON contract.
  on_accept: _complete   # or another step name
  on_reject: fix
```

A step **cannot** mix `next` with `on_accept` / `on_reject`. Each step is either linear or review.

## Transitions

| Field | Used by | Target |
|---|---|---|
| `next` | linear | Another step name |
| `on_accept` | review | `_complete` or another step name |
| `on_reject` | review | Another step name (typically a fix step) |

`_complete` is the only special token. It marks a successful terminal state — the run completes when a review step accepts into `_complete`.

Transition targets must reference steps defined in the same `steps:` map (except `_complete`).

### Choosing `on_accept` vs `next`

- **`next`** — the step always hands off to the same successor. Use for deterministic pipelines (`draft → technical_review`).
- **`on_accept` / `on_reject`** — the successor depends on reviewer judgment. Use when a gate can block or redirect work.

### Chaining review gates

The builtin `two-stage-review-gauntlet` demonstrates two review steps before completion:

```
draft → technical_review ──accept──→ editorial_review ──accept──→ _complete
              │                              │
              └──────── reject ──→ fix ──────┘
                                    │
                                    └── next → technical_review
```

After a reject, route through a fix step and re-enter the earliest gate that must re-validate the changes.

## Review contract

Review steps require agents to end with a fenced JSON block. Pi Baton parses `judgment`, and validates the payload before choosing a branch.

**Accept** — `judgment` must be `"accept"` and `acceptanceNote` must be non-empty:

```json
{"summary":"Short review summary","judgment":"accept","acceptanceNote":"Why this passes"}
```

**Reject** — `judgment` must be `"reject"` and `findings` must be a non-empty string array:

```json
{"summary":"Short review summary","judgment":"reject","findings":["Actionable issue 1"]}
```

Non-review steps only need a `summary` in their JSON block. If parsing fails on a review step, the run fails with a `ReviewContractError`.

Builtin `reviewer` agent prompts include the contract. Custom review agents should instruct the model to follow the same shape.

## `iteration_cap`

`iteration_cap` is a required positive integer. It limits how many times a review step can **reject** before the run fails.

- The counter starts at `0` when a run begins.
- Each review **reject** increments the counter by one.
- Before executing a review step, if `iteration >= iteration_cap`, the run fails with `Iteration cap (N) reached`.
- Accepts and linear steps do not increment the counter.

Example: `iteration_cap: 5` allows up to five review reject cycles (reviews at iterations 0–4). After the fifth reject raises the counter to 5, the next review attempt is blocked.

Set the cap high enough for your loop depth but low enough to prevent runaway reject cycles.

## Model overrides

Each step may set an optional `model` field (`provider/model-id`, e.g. `openai/gpt-5.4`).

| Situation | Model used |
|---|---|
| Step defines a concrete `model` | That model |
| Step omits `model` | Current Pi session model |
| Scaffold placeholder (`<your-fast-model>`) | Current Pi session model |

Convention: use a faster model on worker/linear steps and a stronger model on review steps. `/baton:new` inserts placeholders as a reminder — replace them with real model IDs or remove them to inherit the session model.

Step-level overrides apply per subagent invocation; other steps in the same run can use different models.

## Agent discovery order

Each step's `agent` value must match a Pi subagent `name` from frontmatter. Pi Baton merges agents from three locations; when names collide, **project overrides user overrides builtin**:

1. **pi-baton builtin** — `agents/` in the package (`worker`, `reviewer`)
2. **User** — `~/.pi/agent/agents/*.md`
3. **Project** — nearest `.pi/agents/*.md` walking up from the run's target directory

Discovery order (highest priority first): project `.pi/agents/` → user `~/.pi/agent/agents/` → pi-baton builtin.

If a workflow references an agent name that cannot be resolved, validation fails before the run starts.

To customize behavior, add `.pi/agents/worker.md` or `.pi/agents/reviewer.md` in your project. Use the same `name` as the workflow references so your file overrides the builtin definition.

## End-to-end checklist

1. Run `/baton:new` (or copy a builtin workflow into `.pi/baton/workflows/`).
2. Set `name`, `iteration_cap`, and define `steps:` with the first step as entry.
3. Assign `agent` values that exist in your agent discovery path.
4. Add optional `model` overrides on steps that need a different model.
5. Write prompts that end with the JSON contract (review steps must include judgment rules).
6. Wire transitions: linear steps use `next`; review steps use `on_accept` / `on_reject`.
7. Run `/baton:start` to pick the workflow, then `/baton:run` to execute.

## Examples

Study the shipped workflows for complete, working graphs:

- [`workflows/default-review-loop.yaml`](../workflows/default-review-loop.yaml) — classic `implement → review → fix` loop
- [`workflows/two-stage-review-gauntlet.yaml`](../workflows/two-stage-review-gauntlet.yaml) — chained review gates with a shared fix step
