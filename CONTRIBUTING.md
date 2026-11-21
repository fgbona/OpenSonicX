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

## Releases

1. Move the `Unreleased` entries in CHANGELOG.md to a new version section.
2. Set the same version in `package.json`, `packages/core/package.json` and
   `apps/web/package.json`, and run `npm install --package-lock-only`.
3. Merge to `main`, then push a tag `vX.Y.Z`.

The release workflow refuses a tag that does not match the package versions
or has no changelog section. It publishes the image, smoke-tests the published
image, and only then moves `latest` and creates the GitHub release.

Run the container check locally with:

```sh
docker build -t pocket-master-editor . && scripts/smoke-test.sh pocket-master-editor
```

## README images

The screenshots and the tube animation in `docs/media` come from the dev-only
`/preview` page (a stored preset, no pedal). After a visual change, with
`npm run dev` running, Google Chrome installed and ffmpeg on your PATH:

```sh
node scripts/readme-media.mjs http://localhost:3000/preview
```

## Commits and pull requests

- Conventional commit messages: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- One topic per pull request, with a short test plan.
- CI must be green.
