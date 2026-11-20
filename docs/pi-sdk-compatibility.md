# Pi SDK 1.5.2 compatibility

Pi Baton is verified with the frozen Pi SDK 1.5.2 wave. Its public peer ranges
remain unchanged (`*`); the exact versions are development/test pins only:

- `@earendil-works/pi-agent-core`: `1.5.2`
- `@earendil-works/pi-ai`: `1.5.2`
- `@earendil-works/pi-coding-agent`: `1.5.2`
- `@earendil-works/pi-tui`: `1.5.2`

The extension uses `ExtensionAPI.registerCommand` and
`ExtensionCommandContext`, `getAgentDir`, `parseFrontmatter`,
`withFileMutationQueue`, and the `Model` type. Those APIs typecheck at 1.5.2 and
the actual Pi 1.5.2 host smoke verifies extension loading and command
responses.

The 1.5.1 and 1.5.2 releases document changes this package does not depend on:

- Custom `GrepOperations.readFile` callbacks are no longer called for context
  lines ([#9276](https://github.com/earendil-works/pi/issues/9276)). The field
  stays accepted as optional and deprecated, and Pi Baton overrides no grep
  operations.
- OpenAI-compatible models no longer send an empty `tools` array when tools are
  disabled ([#11843](https://github.com/earendil-works/pi/issues/11843)). Pi
  Baton shapes no provider requests; its subagent runner only passes CLI flags
  (`--tools`, `--model`) to the pinned Pi binary.
- Interactive sessions now offer `Continue`, `Fork`, or `Cancel` when the
  session's working directory is gone ([#11975](https://github.com/earendil-works/pi/pull/11975)).
  Baton subagent steps and the smoke harness run with `--no-session`, so the
  prompt never applies.

Agent-core and TUI remain direct development pins for reproducible wave
coverage, although this package does not import them directly.

From the source checkout, run `npm run smoke:pi` to load the real extension in
the pinned Pi RPC host and exercise registration, `/baton:history`,
`/baton:run` with no active run, reload in a fresh Pi process, clean shutdown,
and the native host shell. The captured observations are in
`docs/verification/pi-sdk-smoke.json`; `npm run ci` executes the harness. It
uses isolated temporary Pi settings and working directories, disables model
inference, and does not mock Pi's extension loader, RPC handling, command
handlers, or process lifecycle. The harness compares the installed SDK versions
with the exact `devDependencies` pins in `package.json` instead of a hard-coded
wave, so moving the pins is the only edit an SDK bump needs.
