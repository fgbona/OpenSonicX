# sonicake-pocket-master-mcp

An MCP server that lets an AI assistant shape the sound of a **Sonicake
Pocket Master** guitar pedal over USB: "build the Black Album rhythm tone on
P50 and save it", "more gain on the amp", "keep this tone".

Unofficial: not affiliated with or endorsed by Sonicake. Product names are
trademarks of their owners, used only to describe the modeled gear.

## Install

Plug the pedal in over USB (a data cable, directly rather than through a
hub), then add the server to your MCP client. Node 22.18 or newer, macOS or
Linux.

Claude Code:

```sh
claude mcp add pocket-master -- npx -y sonicake-pocket-master-mcp
```

Claude Desktop and other clients: run `npx -y sonicake-pocket-master-mcp` as
a stdio server.

npm may warn that `@julusian/midi` has an install script that was not run;
that script only compiles the MIDI library when no prebuilt binary exists,
and macOS and Linux have one.

## What it does

- Reads the loaded preset, the 100 preset names and every model of the
  pedal, with the real gear each model is based on (from the Pocket Master
  manual) and its parameters.
- Edits by name (parameters, block on/off, models including user IRs and
  captured NAM profiles, chain order, volume), live in the edit buffer.
- Builds a tone from a reference (an artist, a record, a song) in one step.
- Saves to a user slot only with a confirmation naming the slot, after
  backing the slot up to `~/.pocket-master-editor/backups`;
  `restore_backup` undoes a save.
- Keeps approved tones as preset files with notes in
  `~/.pocket-master-editor/presets` and reuses them.

Tested on firmware V1.3.3. Source, protocol notes and the web editor:
<https://github.com/fgbona/pocket-master-editor>.

## License

MIT
