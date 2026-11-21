# Read-only Pocket Master editor Implementation Plan

**Goal:** A static web page that connects to a Pocket Master over Web MIDI, reads the edit buffer, shows the chain with parameters, and logs all SysEx in hex, without ever writing to the pedal.

**Architecture:** npm workspaces. `packages/core` is pure TypeScript (bytes in, bytes out, no browser or MIDI API). `apps/web` is a Next.js app whose editor page (a client component) owns the Web MIDI transport and passes raw bytes to core.

**Tech Stack:** TypeScript (erasable syntax only), Node 26 `node:test` with native type stripping, Next.js 16, React 19, TypeScript 6 (Next does not yet build with the TypeScript 7 native compiler).

**Spec:** `docs/superpowers/specs/2026-11-18-read-only-editor-design.md`

## Global Constraints

- Only GET payloads (`payload[0] === 0x12`) may be sent. The web send function throws otherwise.
- Firmware V1.3.3 over USB MIDI.
- No code from Preset Forge (GPL-3.0).
- Core has no dependency on DOM or Web MIDI types; `lib` in core tsconfig is `ES2023` only.
- Core imports use explicit `.ts` extensions so Node runs the sources directly.
- Catalog data carries MIT attribution to `voronkovd/pocket-master-mcp` and its PocketEdit origin.

## Review Focus

- A multi-packet reply with a missing packet must never produce a partial preset; the query is retried, then the UI shows an error. Test: `reassembler drops incomplete sets` (Task 2).
- Device notifications (knob turned on the pedal) arrive between query replies; they must be logged but must not be mistaken for the dump. Test: `waitFor ignores frames with other commands` is covered by matching on command byte in Task 2's `isReply`.
- A frame with bad CRC must be logged and ignored, not decoded. Test: `parseFrame flags bad crc` (Task 1).
- An effect code missing from the catalog must render as its hex code, not crash. Test: `decodePreset unknown code` (Task 3).
- The browser denies SysEx permission or has no Web MIDI: the page shows a readable message. Manual check in Task 4.

---

### Task 1: Workspace and framing

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/frame.ts`, `packages/core/src/hex.ts`
- Test: `packages/core/test/frame.test.ts`

**Interfaces:**
- Produces: `crc8(bytes: readonly number[]): number`, `expand`, `collapse`, `buildFrame(payload: readonly number[], total?: number, index?: number): Uint8Array` (full `F0 … F7`), `parseFrame(sysex: Uint8Array): Frame` where `Frame = { total, index, payload: Uint8Array, crcOk: boolean }`, `toHex(bytes): string` (uppercase, space separated).

- [ ] Test `buildFrame([0x12, 0x43])` equals `F0 00 07 00 01 00 00 00 02 01 02 04 03 F7` and `[0x12, 0x41]` equals `F0 00 09 00 01 00 00 00 02 01 02 04 01 F7` (real TX captures).
- [ ] Test `parseFrame` of real RX `F0 04 0B 00 01 00 00 00 04 01 02 04 03 00 07 00 00 F7` gives payload `12 43 07 00`, crcOk true. Test `parseFrame flags bad crc` after flipping one nibble.
- [ ] Run `npm test`, expect failure, implement, expect pass, commit.

### Task 2: Reassembly and queries

**Files:**
- Create: `packages/core/src/reassembler.ts`, `packages/core/src/queries.ts`
- Test: `packages/core/test/reassembler.test.ts`, `packages/core/test/fixtures/p08-capture.txt` (owner's real capture)

**Interfaces:**
- Produces: `class Reassembler { feed(f: Frame, now: number): Frame | null }` returns a joined frame once packets `0..total-1` are present; restarts on `index === 0` or after 1000 ms. `Query = { CURRENT_PRESET: 0x43, EDIT_BUFFER: 0x41 }`, `queryFrame(kind): Uint8Array`, `isReadOnly(sysex: Uint8Array): boolean`, `isReply(f: Frame, kind: number): boolean`.

- [ ] Test: feeding the 26 dump messages of the P08 capture yields one 476-byte payload starting `12 41`. Test `reassembler drops incomplete sets`: 25 of 26 packets yield null, and a new index-0 packet resets.
- [ ] Test `isReadOnly(queryFrame(0x41))` true, `isReadOnly(buildFrame([0x11, 0x48, ...]))` false.
- [ ] Implement, pass, commit.

### Task 3: Catalog and dump decoder

**Files:**
- Create: `packages/core/src/catalog.json` (copied from the reference `device_map.json`), `packages/core/src/catalog.ts`, `packages/core/src/dump.ts`, `packages/core/src/index.ts`, `NOTICE`
- Test: `packages/core/test/dump.test.ts`, `packages/core/test/fixtures/p34-payload.hex` (reference fixture)

**Interfaces:**
- Produces: `decodePreset(payload: Uint8Array): Preset` with `Preset = { volume, ampMode: 'normal'|'clone', chain: Block[] }`, `Block = { key, label, module, on, model: string, code: number, params: Param[] }`, `Param = { name, value: number, display: string, unit?: string }`. Display rules: switch → on/off, select → option text, otherwise number rounded to step.
- Amp block in clone mode uses module 9 code and the `clone` catalog list, matching low 24 bits.

- [ ] Test P08: volume 65, chain order NR FX1 DRV AMP IR EQ FX2 DLY RVB, AMP `Brit 800` with Middle 71, EQ 400Hz −2, DLY `Analog` off with Time 400, NR on THRE 24.
- [ ] Test P34 fixture decodes without throwing and has 9 blocks.
- [ ] Test `decodePreset unknown code`: patch an effect code, model shows `0x…`.
- [ ] Implement, pass, commit.

### Task 4: Web app

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts` (`transpilePackages: ['@pocket-master/core']`), `apps/web/tsconfig.json`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`
- Create: `apps/web/lib/midi.ts` (Web MIDI transport), `apps/web/lib/usePocketMaster.ts` (React hook: ports, connection, log, preset)
- Create: `apps/web/components/PortPicker.tsx`, `ChainView.tsx`, `SysexLog.tsx`

**Interfaces:**
- Consumes: everything exported by `@pocket-master/core`.
- `midi.ts`: `openMidi(): Promise<MIDIAccess>` (sysex: true), `sendReadOnly(output, bytes)` that throws unless `isReadOnly`.
- `usePocketMaster()` returns `{ status, error, inputs, outputs, inputId, outputId, select, connect, read, preset, presetIndex, log, clearLog }`. `read()` sends CURRENT_PRESET then EDIT_BUFFER, each retried twice with a 1500 ms timeout.
- Log line: `HH:MM:SS.mmm TX|RX hex`, capped at 2000 lines, Copy and Clear buttons.
- Port pickers auto-choose names containing "Pocket Master".

- [ ] `npm run build` and `npm run typecheck` succeed.
- [ ] Manual check in Chrome with the pedal: preset P08 matches the hardware; unsupported browser and denied permission show a readable message.
- [ ] Commit, create repo `fgbona/pocket-master-editor` (private until catalog licensing is settled), push.
