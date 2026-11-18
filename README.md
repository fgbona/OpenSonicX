# Pocket Master Editor

A free, open-source browser editor for the **Sonicake Pocket Master** guitar
multi-effects pedal, over USB MIDI. No install and no driver: open the page in
Chrome, Edge or Opera, plug the pedal in, and read your preset.

> **Status: preview.** Reading, live editing and saving to preset slots work.
> Every save backs up the slot it overwrites, unless you opt out for that save.

## What it does today

- Lists MIDI ports and connects to the Pocket Master.
- Reads the edit buffer and shows the signal chain with every parameter.
- Live edit (off by default): parameters, block on/off, model per block and
  chain order, sent to the pedal's edit buffer as you move the controls.
  Nothing is saved to a slot.
- Revert brings the preset back to how it was first read, including knob
  turns made on the pedal.
- Saves to a user slot (P01..P50), backing up the slot it overwrites
  first (you can skip that per save). Backups can be downloaded and
  restored from the Backups panel.
- Logs every SysEx message sent and received, in hex, with a label.

Tested on firmware **V1.3.3** over USB.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | The SysEx protocol in TypeScript: framing, decoding, model catalog. No browser or MIDI dependency, so the web app and a future MCP server share it. |
| `apps/web` | The Next.js editor. Web MIDI runs in the visitor's browser. |
| `apps/mcp` | Planned: an MCP server on top of `packages/core`. |
| `docs/` | Design notes and plans. |

## Run it

Requires Node 22.18 or newer.

```sh
npm install
npm test          # core protocol tests, with coverage
npm run dev       # editor at http://localhost:3000
```

In a container, from the published image:

```sh
docker run --rm -p 3000:3000 ghcr.io/fgbona/pocket-master-editor:latest
```

Or build it yourself:

```sh
docker compose up --build   # editor at http://localhost:3000
```

The container only serves the page. The browser talks to the pedal, so the
container needs no USB access. Web MIDI only works on `https` or `localhost`.

The image is Alpine with only the Node binary (no npm, no package manager),
runs as an unprivileged user and works with a read-only root filesystem. `compose.yaml` applies those restrictions
and binds the port to localhost only. To serve it publicly, put it behind a
reverse proxy that terminates HTTPS.

## Protocol

The wire format follows [`docs/PROTOCOL.md`](https://github.com/voronkovd/pocket-master-mcp/blob/main/docs/PROTOCOL.md)
of pocket-master-mcp (MIT). The implementation here was written from scratch.
Real captures from a V1.3.3 unit live in `packages/core/test/fixtures` and are
the reference the tests check against.

## Releases

Each version is a git tag, a [GitHub release](https://github.com/fgbona/pocket-master-editor/releases)
and a container image in the GitHub Container Registry. Changes are listed in
[CHANGELOG.md](CHANGELOG.md). Versions below 1.0 are previews.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; the
most useful thing you can send is a SysEx capture from your own unit.

## Credits and license

MIT, see [LICENSE](LICENSE). The model catalog comes from pocket-master-mcp,
which derived it from [PocketEdit](https://github.com/suckyble/PocketEdit);
see [NOTICE](NOTICE). Not affiliated with Sonicake.
