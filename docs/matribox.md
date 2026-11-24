# Sonicake Matribox II Pro (in progress)

The goal: an MCP server where you describe a tone and the AI builds it on the Matribox II Pro,
like the Pocket Master server does today. What exists so far: the protocol groundwork in
`packages/core/src/matribox/` (framing, pages, LZO1X, messages, name tables, the preset decoder),
the model catalog reader, and the MCP server (below): the read tools, and **experimental** write tools
decoded from captures but not yet validated on the unit. No editor UI yet.

Everything below was learned from our own captures of the owner's unit (USB MIDI, 2026-11-24):
the official editor's traffic, and replays of its **read** requests only.

## Connection

- USB composite device: USB audio plus a class-compliant MIDI port named `Matribox II PRO`
  (in and out). No driver; Web MIDI, Electron and Node can all open it.
- It is the Valeton GP-200 platform. The official editor first sends a probe the unit does not
  answer: `F0 21 25 7E 47 50 2D 32 11 12 00 00 00 F7` (`~GP-2`).

## Frames

```
F0 21 25 4D 50 00 00 <ck> <type> <len lo> <len hi> <off lo> <off hi> <data nibbles…> F7
```

| Byte  | Meaning |
|-------|---------|
| 0-6   | Header `F0 21 25 4D 50 00 00` (`MP`) |
| 7     | Checksum |
| 8     | Type: `11` read request, `12` write (host); `00` reply or notification (unit) |
| 9-10  | Total decoded length of the message, two 7-bit bytes (lo, hi) |
| 11-12 | Offset of this page in the message, two 7-bit bytes (lo, hi) |
| 13…   | Data: each byte sent as two nibbles, high nibble first |

- **Checksum (host frames):** `sum(frame[10 : len-1]) & 0x7F`, every byte after byte 9 up to
  (not including) `F7`. It matches all 38 host frames captured (11 reads, 27 writes). The unit's
  replies use another rule, not decoded yet: we keep their checksum and do not check it.
- **Pages:** a long reply comes as 384-byte frames, 185 decoded bytes each, every page carrying
  the same total length and its own offset (0, 185, 370, …). Verified on every reply captured:
  e.g. the reply to the `1D 11 10` read is 17 pages, total 2972 bytes (`1C 17` = 28 + 23 × 128),
  and contains the device name and the preset names.
- Byte 9 was first read as a sub-command (`11 10`, `12 1C`, …); it is the low byte of the length:
  the read requests carry 16 or 8 bytes, the parameter drag writes 28.
- **Parameter values** are float32 little-endian, as in the Pocket Master's dumps (knob turns
  decoded as 91, 100 and 64).

What the official editor does on connect: the probe, then reads `11 10` (device info and preset
names, current preset) and `11 08` (user IR names, capture names, other tables). A knob drag
streams `12 1C` writes, a block on/off is `12 18`, selecting a preset is `12 21` followed by a
re-read. Saving was seen once (cmd `05`, see Writes); renaming was not captured yet.

## Messages

The joined page data of every message, both ways, is a message:

```
[flag u8] [0] [0] [cmd u8] [length u32 LE] [LZO1X stream, length bytes]
```

`length` is always the payload length − 8 (checked on all 22 messages of the capture). There is no
uncompressed form: even the 20-byte replies carry a 12-byte LZO1X stream that decodes to 8 bytes,
and the host's read requests store their 4-byte argument as a literal-only stream
(`15 <4 bytes> 11 00 00`). A request without an argument has length 0 and no stream.
`unwrapMbMessage` (core) checks the header and length and decompresses; `mbRequest(flag, cmd, arg)`
builds a read request frame.

### LZO1X

`lzo1xDecompress` in `packages/core/src/matribox/lzo1x.ts` is our own implementation, written from
the public description of the format (the Linux kernel's `Documentation/staging/lzo.rst`). The
data comes from a USB device or a downloaded file, so every read, write and back-reference is
checked, the output is capped (1 MiB by default), and malformed, truncated or trailing input
throws. It was checked byte for byte against liblzo2's `lzo1x_decompress_safe` outside the
repository: every real reply, 1500 random inputs compressed by `lzo1x_1_compress`, 1500 mutated
streams and 3000 random byte strings (same output, and the same accept or reject). The test
vectors in the repository are compressed from invented plaintext.

### The reads the official editor sends on connect

After the `~GP-2` probe, in this order (`arg` = the decompressed request data):

| flag | cmd | arg | Reply (decompressed) |
|------|-----|-----|----------------------|
| 1 | 10 | `00 00 0A 01` | Preset list, 7444 bytes (below). `mbReadPresetNames()` |
| 1 | 10 | `01 00 0A 01` | 8 bytes: the argument, then u32 LE current preset number (66). `mbReadCurrentPresetNumber()`, `parseMbCurrentPresetNumber` |
| 0 | 10 | `43 00 00 00` | A preset, 1211 bytes ("Drive AD"; see below). `mbReadPreset(0x43)` |
| 1 | 11 | `00 08 00 00` | 8 bytes: the argument, then `00 00 00 00` |
| 0 | 14 | none | User IR names, 500 bytes. `mbReadIrNames()` |
| 0 | 18 | none | Capture (clone) names, 252 bytes. `mbReadCloneNames()` |
| 0 | 11 | none | 52 bytes, not decoded (global settings?) |
| 0 | 13 | none | 10 bytes `00 00 07 00 00 00 3C 00 00 5D`, not decoded |
| 0 | 16 | none | 124 bytes of float32 values, not decoded |
| 1 | 16 | `01 00 00 16` | 8 bytes `00 00 00 00 01 00 00 00` |
| 0 | 10 | `42 00 00 00` | A preset again, 1211 bytes, "Drive AD". `mbReadPreset(0x42)` |

The preset read's argument is a u32 that the reply's first 4 bytes repeat. `42` (66) is the current
preset; the first read asks for `43` and also gets "Drive AD" (preset 67 is "Cry&Cry"), and the two
replies differ in one byte (offset 37: `00` / `80`), so `43` may mean the edit buffer. Not confirmed:
open question. The MCP server reads the current preset number first and then `mbReadPreset(number)`,
the editor's last read; after a preset select the official editor also re-reads that way. Whether this
returns the stored slot or the edit buffer with unsaved changes is to be checked on the unit (change a
knob, then read).

### Name tables

Names are 17-byte fields, NUL-terminated (16 characters at most); the bytes after the NUL are left
over from older names and are ignored.

- **Preset list** (`parseMbPresetNames`): 4 bytes (the request's argument), 240 u32 LE (values
  2..241 on the owner's unit, meaning unknown), 240 names (17 bytes), 240 style tags (10 bytes:
  "Rock", "Metal", "Acoustic", "" when unset; the owner's rig presets say "@lex"). 4 + 240 × 31 =
  7444. The index is the preset number: the current-preset read returns 66, and name 66 is
  "Drive AD". Name 0 is "Matribox II PRO" (the default name of an empty preset) and "Love of God"
  is 1.
- **User IRs** (`parseMbIrNames`): 20 × 8 bytes (all zero so far), then 20 names: 500 bytes.
- **Captures** (`parseMbCloneNames`): 10 × 8 bytes (zero), then 10 names ("1 FENDER", …,
  "Clone 10"), padded to 252 bytes.

### Presets

A preset read from the unit is 1211 bytes decompressed: its u32 number, then 9 sections. A Matribox
`.prst` file is base64 of a JSON byte array that is itself a raw LZO1X stream (no message header)
holding the same 9 sections, 1207 bytes. Checked on 22 presets (the owner's unit and `.prst` files);
nothing in a preset is a checksum.

Each section is `u32 tag` (`0x10000000` on the unit, `0x10000002` in a `.prst`), `u32 length`, then
a body that starts `00 00 <id> 01`. Ids and body sizes are fixed: 0 (11), 1 (105), 2 (10), 3 (15),
4 (76), 5 (742), 7 (95), 8 (69), 9 (12).

| Section | Offset in body | Meaning |
|---------|----------------|---------|
| 1 | 8 | Name, NUL-terminated (stale bytes after it) |
| 1 | 95 | Style tag ("Rock", "@lex") |
| 4 | 4 | Chain: up to 12 storage slots in signal order, `FF` = none |
| 4 | 16 | Module index per slot (catalog `Modules[].index`: DYN 0 … VOL 15), `FF` = unused |
| 4 | 28 | u32 fxid per slot (catalog `alg[].fxid`). IR `0x0A1000nn` = user IR nn, CLONE `0x0F00000n` = capture n |
| 5 | 4 + slot × 60 | 15 float32 per slot, indexed by the catalog widget `ID`, in real units |
| 5 | 724 + slot | On/off per slot |

A slot is a storage slot, not a chain position (live edits address the slot). Values at positions
the slot's model does not use are left over from earlier models: only the model's widget IDs are read.
Sections 0, 3 and 9 are constant; 2, 7 and 8 (likely quick-knob, expression pedal and footswitch
assignments) and the rest of 1 and 5 are not decoded yet.

`parseMbPreset` (core) takes either size and returns a frozen preset: number (null for a `.prst`),
name, style, chain (slot, module index, fxid, on, the 15 values) and every section raw, for a later
writer. `parseMatriboxPrst(text)` reads a `.prst`. `resolveMbPreset(preset, catalog)` names the
modules, models (with the gear they are based on) and parameters with their ranges; an fxid the
catalog does not know is kept and shown as unknown. `mbPresetLabel(i)` gives the label the unit
shows: four presets per bank, `1A`..`60D` (the official editor selected 60D with index 239).

## MCP tools

The MCP server in `apps/mcp` talks to whichever supported pedal is plugged in. The pedals are told
apart by their MIDI port name (`Pocket Master`, `Matribox II PRO`; `apps/mcp/src/devices.ts`). The
Pocket Master keeps its tools; the Matribox's start with `matribox_`, and nothing they send writes:

- `which_pedal`: which supported pedals are connected (it lists MIDI ports, nothing is sent).
- `matribox_list_presets`: the 240 presets by label, with style tags, the loaded one marked.
- `matribox_get_preset`: the loaded preset: chain in order, each block's model and the gear it is
  based on, on/off, parameters by name with their ranges; IR and CLONE blocks show the slot's name.
- `matribox_list_models`: the catalog by module (all 16, or one), with origins and parameter ranges:
  the palette the assistant plans a tone from. Read from the official app's install (below); the
  tool says how to fix a missing catalog.
- `matribox_list_irs`, `matribox_list_captures`: the user IR and capture slot names.

Each call opens the ports, sends only the official editor's read requests (`11` frames), collects
and joins the reply pages, and closes. A reply is matched by its flag, cmd and the argument it
repeats, so notifications the unit sends on its own (footswitches, knobs) are skipped; no answer in
3 seconds is an error. Tests run against a simulated unit that answers with our captured replies.

The write tools (experimental: every answer says so until the owner validates them on the unit):

- `matribox_set_param`: one parameter of a block, by the name `matribox_get_preset` shows, refused
  outside the catalog's range. A block is named by its chain position or its module.
- `matribox_set_module_on`: a block on or off.
- `matribox_select_preset`: loads a preset by label (unsaved changes are lost).
- `matribox_set_model`: swaps the model in a block (assignment tables, the chain with the slot's new
  module and fxid, then every parameter at the model's default).
- `matribox_build_tone`: the whole chain in one call, `[{module, model, on?, params?}]` in signal
  order, block i in slot i, every parameter written (the model's default when not given). All of it
  is checked against the catalog before anything is sent. It clears the assignment tables.
- `matribox_save_preset`: stores the loaded preset in a slot under a name. `confirm` must repeat the
  slot label; the slot is read first and kept in `~/.pocket-master-editor/backups`
  (`<time>-matribox-<label>.json`: label, index, name and the 1211 bytes as hex).

Each write waits for the unit's echo of it (same flag, cmd and data; 3 s). Tests run against a
simulated unit that applies the writes to an in-memory preset and echoes them.

## Writes

Every write is a flag-1 message in a type `12` frame, its data a literal-only LZO1X stream, and the
unit echoes it back as a type `00` message (it may compress the echo). The data, from captures 1
(host frames) and 2 (the official editor editing the empty preset 60D; only the unit's echoes were
recorded). Builders in `packages/core/src/matribox/write.ts`; tests compare them with both captures
(`packages/core/test/fixtures/matribox-writes.txt`).

| Write | cmd | Data | Evidence |
|-------|-----|------|----------|
| Set param | 10 | `01 00 05 01` + u32 slot + u32 param ID + f32 value | Host frames, byte-exact |
| On/off | 10 | `02 00 05 01` + u32 slot + u32 0/1 | Host frames, byte-exact |
| Select | 10 | `01 00 0A 01` + u32 index (60D = 239) | Host frames, byte-exact |
| Chain | 10 | `00 00 04 01` + sec4 from byte 4 (order, module per slot, u32 fxid per slot) + 12 on/off bytes + 1 byte | Echoes: add, change model, add a slot, reorder, remove |
| Assignments | 10 | `04 00 04 01` + 156 bytes (below) | Echoes, empty preset only |
| Save | 05 | u32 index + 17-byte name (NUL-padded) | One echo (60D), one host frame |

- Set param and on/off address the **storage slot**, not the chain position (capture 2: the delay
  was slot 1 while first in the chain).
- The chain message's last byte was the slot added, changed or removed, and `FF` for a reorder; we
  send the changed slot for a model swap and `FF` for a whole new chain. Meaning not confirmed.
- **Assignments**: sent before every chain change but the reorder. Our reading (hypothesis): sec2
  from byte 4 (6 bytes), sec7 from byte 5 (90) and sec8 from byte 9 (60), the tables that name
  slots (quick knobs?, expression pedal, footswitches). Only the empty preset's tables were seen;
  sec2[9] and sec7[4] are 0 in all 22 samples, so the split could be one byte off. A model swap
  resends the loaded preset's tables; a new chain sends empty ones.
- **Save** is the least verified: capture 1 also has a cmd `05` with index 0x43 and that preset's
  own name, sent before a select. Gated behind `confirm` and a backup.

Open questions for the hardware test: does the unit accept our frames as it accepts the editor's
(the echo says so); does the unit load the new model's defaults itself on a chain change; what the
chain message's last byte means; the assignment split; whether cmd `05` saves; whether reading the
loaded preset's number returns the edit buffer or the stored slot (it decides whether the backup
taken before saving over the loaded slot holds the stored preset or the edits).

## Phases

The same gates as the Pocket Master: each phase is validated by the owner on his unit before the
next one starts.

1. **Read only:** connect, read device info, preset names, the current preset. Nothing sent but
   the read requests the official editor sends. Done in the MCP server; waiting for the owner's
   check on the unit.
2. **Live edit:** parameter and block writes (`12` frames). Built and tested against the simulated
   unit; waiting for the owner's check on the unit.
3. **Save:** writing presets to slots, with a backup of every slot it overwrites. Built (cmd `05`,
   unverified); waiting for the owner's check.
4. **MCP tools:** describe a tone, the assistant builds it on the unit (`matribox_build_tone`).

## The model catalog

The models and their parameters (16 modules, 267 models) come from the official editor's
`alg_data.json`. That file is **Copyright Sonicake**: it is never copied into this repository,
bundled, published or quoted. We read it at run time from the user's own installed app:

- macOS: `/Applications/Matribox II PRO.app/Contents/Frameworks/App.framework/Resources/flutter_assets/assets/alg/alg_data.json`
- Windows: `%ProgramFiles%\Matribox II PRO\data\flutter_assets\assets\alg\alg_data.json`
  (the usual Flutter layout; not yet checked on a real install)
- Anywhere: set `MATRIBOX_CATALOG` to the path of `alg_data.json`.

`parseMbCatalog` (core) validates the parsed JSON and returns a frozen catalog;
`loadMatriboxCatalog` (`apps/mcp`) reads the file. Tests use a small invented catalog.

## Clean room

Community projects about this unit exist online, but none has a license, so none of their code is
used here. Reading them for ideas is allowed; the code is our own, written from our captures.
