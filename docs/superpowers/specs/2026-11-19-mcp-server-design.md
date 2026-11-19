# MCP server (front 2)

## Intent

The owner's original plan: an MCP server on the same core as the web editor, so an
assistant can read, tweak and save Pocket Master presets in conversation. The owner
delegated this front ("seguir com suas sugestões") while away from the computer.

## Goals

- `apps/mcp`: a stdio MCP server that talks to the pedal over USB MIDI from Node.
- Same safety as the web editor: the same guarded send paths, the same flows
  (save with target backup, restore, load preset files), the same tests.
- Tools for reading (preset, names, models, log), live edits (parameter, block,
  model, chain, volume, revert), preset files (export/import) and saving.

## Non-goals

- Firmware updates, global settings, BLE.
- Releasing it before the owner validates it on the pedal.

## Constraints

- Work done while the owner is away: nothing is written to the pedal; real-hardware
  checks are read-only queries. The server is released only after the owner tests it.
- Node 24 with type stripping runs the TypeScript sources directly (no build step),
  like the core tests. Node MIDI: `@julusian/midi` pinned to 3.8.1 (3.9.0 is days old).

## Design

1. **Move the link into core.** `PocketMasterLink` (request/edit/presetOperation with
   their guards, edit queue, acknowledges, notifications, reassembly) moves from
   `apps/web/lib/midi.ts` to `packages/core/src/link.ts`, over a minimal port:
   `{ send(bytes), setReceiver(cb | null) }`. Web adapts `MIDIInput`/`MIDIOutput`; the MCP
   adapts `@julusian/midi`. `webPedal` becomes core `linkPedal(link)`. The link tests move
   to core. One implementation of the safety-critical code for both apps.
2. **MCP server** (`apps/mcp/src`): `server.ts` (stdio, tool registration),
   `session.ts` (connection, current preset, restore point, IR/profile names),
   `tools/*.ts` grouped by read / edit / files / save. Tool inputs use names the way a
   musician says them ("AMP", "Gain", "Brit 800", "P09") and are validated with zod;
   resolution of names to modules/slots/codes lives in core (`resolve.ts`) and is tested.
3. **Writes are explicit.** Live-edit tools change only the edit buffer. `save_preset`
   needs `confirm` equal to the target slot label (e.g. "P03") and backs the slot up to
   `~/.pocket-master-editor/backups/` first unless `backup: false`. Tools carry MCP
   annotations (`readOnlyHint`, `destructiveHint`).

## Approaches considered

1. Link in core over a tiny port interface (chosen): one guarded implementation, tested once.
2. Duplicate the link in the MCP app: faster now, two safety-critical copies to keep in sync.
3. MCP talks to the browser editor: needs the page open; brittle.
