# MCP server Implementation Plan

> Inline execution. **Spec:** `docs/superpowers/specs/2026-11-19-mcp-server-design.md`

## Global constraints
- Nothing is sent to the pedal while building this; hardware checks are read-only.
- The link's guards (GET-only requests, allowed edits, preset operations) stay byte-identical.

## Review focus
- After the move, the web editor behaves exactly as before (same tests, same guards).
- A tool can never send a save or select without its explicit inputs.
- Name resolution never picks a wrong block or slot silently (ambiguous names fail).

### Task 1: Link in core
`packages/core/src/link.ts` (PocketMasterLink over `MidiPort`), `pedal.ts` (`linkPedal`), tests moved from
`apps/web/test/midi.test.ts`; web keeps only Web MIDI adapters (`openMidi`, `pickPocketMaster`, `webMidiPort`).

### Task 2: Name resolution (core)
`resolve.ts`: `resolveBlock`, `resolveParam`, `resolveModel` (incl. user IR and profile names), `resolveSlot`,
`parseValue` (numbers, on/off, option names). Tests for exact, case-insensitive, unique-prefix and ambiguous names.

### Task 3: MCP app
`apps/mcp`: Node MIDI port, session, tools, stdio server; tests with a fake port that simulates the pedal.
README section on adding it to Claude Code / Claude Desktop.
