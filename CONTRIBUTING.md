# Contributing

Thanks for helping. This project talks to real hardware, so the rules below
exist to keep everyone's pedal safe.

## Ground rules

- **Nothing writes to the pedal without a backup first.** Any feature that
  sends a set command (`0x11`) must read and keep the current state before it
  writes, and must be reviewed with that in mind.
- **Protocol changes need a capture.** If you change decoding or add a command,
  add the real SysEx you captured to `packages/core/test/fixtures` with the
  firmware version, and a test that uses it.
- **Do not copy code from GPL projects** such as Preset Forge. Reading public
  protocol documentation is fine; write the code yourself.

## Development

```sh
npm install
npm test           # protocol tests (node:test, no extra framework)
npm run typecheck
npm run dev        # http://localhost:3000
```

- Write the failing test first, then the code.
- `packages/core` must stay free of browser and Node-only APIs so the web app
  and the MCP server can share it.
- Keep files small and focused. Prefer returning new objects over mutating.

## Sending a capture

The editor's SysEx log has a Copy button. Paste the lines into an issue with:
your firmware version, the preset you read, and what the pedal screen shows.
That is enough to add a test.

## Commits and pull requests

- Conventional commit messages: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- One topic per pull request, with a short test plan.
- CI must be green.
