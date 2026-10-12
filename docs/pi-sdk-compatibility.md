# Pi SDK 1.1.0 compatibility

Pi Baton is verified with the frozen Pi SDK 1.1.0 wave. Its public peer ranges
remain unchanged; the exact versions are development/test pins only:

- `@earendil-works/pi-agent-core`: `1.1.0`
- `@earendil-works/pi-ai`: `1.1.0`
- `@earendil-works/pi-coding-agent`: `1.1.0`
- `@earendil-works/pi-tui`: `1.1.0`

The extension uses the current `ExtensionAPI.registerCommand` and
`ExtensionCommandContext` interfaces, `getAgentDir` and `parseFrontmatter` from
the coding-agent package, and the `Model` type from `pi-ai`. No deprecated API
replacement was needed for this package. The agent-core and TUI packages are
also pinned directly for reproducible SDK smoke coverage, although this package
does not import them directly.

Run `npm run smoke:pi` to load the real extension in the pinned Pi RPC host and
exercise command registration, `/baton:history`, the no-active-run error path,
a second host process, shutdown, and the native host shell. The captured
observations are in `docs/verification/pi-sdk-smoke.json`, and `npm run ci`
executes the harness. The probes use isolated temporary Pi settings and working
directories, disable model inference, and do not mock Pi's extension loader,
RPC handling, command handlers, or process lifecycle.
