# Pi SDK 1.5.0 compatibility

Pi Baton is verified with the frozen Pi SDK 1.5.0 wave. Its public peer ranges
remain unchanged (`*`); the exact versions are development/test pins only:

- `@earendil-works/pi-agent-core`: `1.5.0`
- `@earendil-works/pi-ai`: `1.5.0`
- `@earendil-works/pi-coding-agent`: `1.5.0`
- `@earendil-works/pi-tui`: `1.5.0`

The extension uses `ExtensionAPI.registerCommand` and
`ExtensionCommandContext`, `getAgentDir`, `parseFrontmatter`,
`withFileMutationQueue`, and the `Model` type. The [Pi 1.5.0 release
notes](https://github.com/earendil-works/pi/releases/tag/v1.5.0) document the
tool-argument validation move to `@earendil-works/pi-schema` and note that
TypeBox features outside JSON Schema no longer apply to Pi tool arguments.
Pi Baton registers commands, not Pi tools; its workflow schemas use the direct
`typebox` dependency and its own validation path. It does not import `Type` from
`pi-ai` or use TypeBox-only tool validators. The changes therefore do not alter
this package's schema behavior. The SDK APIs listed above typecheck at 1.5.0,
and the actual Pi 1.5.0 host smoke verifies extension loading and command
responses. Agent-core and TUI remain direct development pins for reproducible
wave coverage, although this package does not import them directly.

From the source checkout, run `npm run smoke:pi` to load the real extension in
the pinned Pi RPC host and exercise registration, `/baton:history`,
`/baton:run` with no active run, reload in a fresh Pi process, clean shutdown,
and the native host shell. The captured observations are in
`docs/verification/pi-sdk-smoke.json`; `npm run ci` executes the harness. It
uses isolated temporary Pi settings and working directories, disables model
inference, and does not mock Pi's extension loader, RPC handling, command
handlers, or process lifecycle.
