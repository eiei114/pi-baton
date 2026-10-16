# Pi SDK 1.2.0 compatibility

Pi Baton is verified with the frozen Pi SDK 1.2.0 wave. Its public peer ranges
remain unchanged (`*`); the exact versions are development/test pins only:

- `@earendil-works/pi-agent-core`: `1.2.0`
- `@earendil-works/pi-ai`: `1.2.0`
- `@earendil-works/pi-coding-agent`: `1.2.0`
- `@earendil-works/pi-tui`: `1.2.0`

The extension uses `ExtensionAPI.registerCommand` and
`ExtensionCommandContext`, `getAgentDir`, `parseFrontmatter`,
`withFileMutationQueue`, and the `Model` type. The [Pi 1.2.0 release
notes](https://github.com/earendil-works/pi/releases/tag/v1.2.0) change
`before_agent_start` events to a `messageType` union and change startup-time
session-busy behavior (`ctx.isIdle()` and `sendUserMessage()` delivery rules).
Pi Baton does not register that event handler or call those session methods, so
no API migration was needed. Typechecking and the actual Pi 1.2.0 host smoke
verify the APIs this package does use. The agent-core and TUI packages are also
pinned directly for reproducible SDK smoke coverage, although this package does
not import them directly.

From the source checkout, run `npm run smoke:pi` to load the real extension in
the pinned Pi RPC host and exercise registration, `/baton:history`,
`/baton:run` with no active run, reload in a fresh Pi process, clean shutdown,
and the native host shell. The captured observations are in
`docs/verification/pi-sdk-smoke.json`; `npm run ci` executes the harness. It
uses isolated temporary Pi settings and working directories, disables model
inference, and does not mock Pi's extension loader, RPC handling, command
handlers, or process lifecycle.
