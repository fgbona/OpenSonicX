# Sonicake Matribox II Pro (in progress)

The goal: an MCP server where you describe a tone and the AI builds it on the Matribox II Pro,
like the Pocket Master server does today. What exists so far: the protocol groundwork in
`packages/core/src/matribox/` (framing, pages, LZO1X, messages, name tables, the preset decoder),
the model catalog reader, and the MCP server (below): the read tools, and **experimental** write tools
decoded from captures but not yet validated on the unit, and the editor UI (below).

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

- **Checksum (host frames):** `sum(frame[13 : len-1]) & 0x7F`, the data nibbles only, up to (not
  including) `F7`. It matches all 38 single-page host frames captured (11 reads, 27 writes; their
  bytes 10-12 are 0, so the first reading, from byte 10, matched them too) and the three pages of
  the official editor's whole-preset write (capture mb-20), whose length and offset bytes are not
  summed. The unit's replies use another rule, not decoded yet: we keep their checksum and do not
  check it.
- **Host pages:** the whole-preset write is the only host message longer than one frame: pages of
  **183** decoded bytes (380-byte frames), each with the total length and its own offset, like
  the unit's 185-byte reply pages. `buildMbFrames` (core) pages a host message that way.
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
Sections 0, 3 and 9 are constant; 2, 7 and 8 hold the knob, expression pedal and footswitch
assignments, partly decoded: see [Unknown sections](#unknown-sections).

`parseMbPreset` (core) takes either size and returns a frozen preset: number (null for a `.prst`),
name, style, chain (slot, module index, fxid, on, the 15 values) and every section raw, for
`writeMatriboxPrst`. `parseMatriboxPrst(text)` reads a `.prst`. `resolveMbPreset(preset, catalog)` names the
modules, models (with the gear they are based on) and parameters with their ranges; an fxid the
catalog does not know is kept and shown as unknown. `mbPresetLabel(i)` gives the label the unit
shows: four presets per bank, `1A`..`60D` (the official editor selected 60D with index 239).

## Unknown sections

What we could decode of the rest, offline, from 27 presets (22 `.prst` files and 5 reads from the
owner's unit: "Drive AD" twice, "Cry&Cry", "TESTE OSX" twice) and the unit's side of the captures: captures 1 to 4 (see Writes) and the **hardware capture** (unit side only, the owner pressing the footswitches and turning the knobs on the unit; kept outside the repository).
Offsets are in the section **body** (its `00 00 id 01` head included), as in the table above.
Confidence: **high** = matches every sample and a capture shows it working; **medium** = fits every
sample, one capture or a clear pattern; **low** = a guess that fits. [docs/matribox-captures.md](matribox-captures.md)
lists the captures that would settle each open point.

### Section 2 (10 bytes): the three knob assignments

| Offset | Type | Meaning | Evidence | Confidence |
|--------|------|---------|----------|------------|
| 4, 5 | u8 × 2 | Slot that knob 1 and knob 2 edit, `FF` = none | Hardware capture: on "Cry&Cry" (`04 01`), turning the knobs on the unit sent set-param messages for slot 4 and slot 1 | High |
| 6 | u8 | Knob 3's target: `0D` in all 27 presets (not a slot; 0..11 are) | Constant. In the hardware capture, knob 3 sent `03 00 05 01` + u32 (below), not a slot's set-param | Medium |
| 7, 8 | u8 × 2 | Parameter (catalog widget ID) of knob 1 and knob 2 | "Cry&Cry" `00 01`: DYN Threshold, WAH Q, the IDs the knob turns carried. "Drive AD": DRV Gain, AMP Gain. Rig presets: Volume of both drives | High |
| 9 | u8 | Knob 3's parameter: `00` everywhere | Constant | Low |

So the table is three `(slot, param)` pairs stored as `[slot1 slot2 slot3][param1 param2 param3]`.
Slot numbers must be remapped when slots are renumbered.

### Section 7 (95 bytes): expression pedal assignments

| Offset | Type | Meaning | Evidence | Confidence |
|--------|------|---------|----------|------------|
| 4 | u8 | Which EXP 1 mode is active: 0 = A (volume), 1 = B (wah) | 1 in "Cry&Cry", the only sample with its wah on; 0 in the 26 others (wah off or no wah) | Medium |
| 5..13 | u8 × 9 | Target slot of entries 0..8, `FF` = none | Entry 0 is the VOL slot ("Drive AD", "Cry&Cry", 5 rig presets), entry 3 the WAH slot (every preset with a wah) | High (slots), medium (grouping) |
| 14..22 | u8 × 9 | Target parameter (widget ID) of each entry | "Cry&Cry" entry 3 = WAH Position (ID 3); the `.prst` files use ID 0 | Medium |
| 23..58 | f32 × 9 | Minimum of each entry: 0 in every sample | Constant | Medium (layout), low (units: % or real?) |
| 59..94 | f32 × 9 | Maximum of each entry: 100.0 in every sample | Constant | Medium (layout), low (units) |

Reading of the 9 entries (low): three targets per controller, entries 0..2 = EXP 1 mode A (heel-toe
volume), 3..5 = EXP 1 mode B (wah, switched by the toe switch), 6..8 = EXP 2 (an external pedal on
the EXP/CTRL jack). Only entries 0 and 3 were ever used in our samples.

### Section 8 (69 bytes): footswitch assignments

| Offset | Type | Meaning | Evidence | Confidence |
|--------|------|---------|----------|------------|
| 4..8 | 5 bytes | Junk: differs between two reads of the same unchanged preset; zero in one `.prst` that the editor imports | Two "Drive AD" reads, two "TESTE OSX" reads | High (that it is junk) |
| 9 + row × 12 + slot | u8 | 1 = switch `row` (0..4) toggles `slot` | Hardware capture: pressing the footswitches on "Cry&Cry" flipped slots 0, 4, 3, 5 in turn (bulk on/off notices, below), the slots its rows 0..4 name. The rig presets map the same musical layout onto different slots | High (row = switch, column = slot) |

Which physical switch each row is, is not known (low): five rows for four switches A–D, so row 4 may
be the CTRL/external switch. Rows 3 and 4 are identical in 21 of the 24 presets that assign switches.

### Rest of sections 1, 5 and 9; sections 0 and 3

| Section, offset | Type | Meaning | Evidence | Confidence |
|-----------------|------|---------|----------|------------|
| 1, 4..7 | 4 bytes | Junk (two reads of the same preset differ) | Device reads | High |
| 1, 24..94 | f32 noise | Junk: tiny floats (pairs of equal values), zero or -0.0 in files | Two reads of "TESTE OSX": noise, then all zero | High |
| 5, 736 | u16 | Patch volume, 0..100: 45..90 per preset (45, 50, 60, 63, 70, 90 seen) | Varies per preset; not captured being edited | Medium |
| 5, 738 | u16 | Tempo (BPM): 120 in all 27 presets | Constant | Low |
| 5, 740 | u16 | 0 in all 27 presets (tempo source or tap mode?) | Constant | Low |
| 0, 4..10 | 7 bytes | `04 03 0C 01 05 01 0F`, constant (format version?) | 27 presets | Low |
| 3, 4..14 | 11 bytes | `01 02 03 04 00 00 00 00 07 00 05`, constant (switch functions?) | 27 presets | Low |
| 9, 4..11 | f32 + 4 bytes | `00 00 80 3F` (1.0) then `C8 00 00 30` (200 …), constant | 27 presets | Low |

### The unit's own messages (unsolicited)

All are flag 1, cmd `10` or `11`, and the official editor never sends them. From the hardware capture and
captures 1 to 4.

| Data | Meaning | Evidence | Confidence |
|------|---------|----------|------------|
| `01 00 05 01` + u32 slot + u32 param + f32 | A knob turned on the unit: same shape as the host's set param | Hardware capture: knob 1 and 2 turns hit the slot and parameter section 2 names | High |
| `03 00 05 01` + u32 value | Knob 3 turned: values 42, 82, 83, 52, 53 (0..100). Probably the patch volume (section 2 target `0D`, section 5 at 736) | Hardware capture | Medium (knob 3), low (patch volume) |
| `07 00 05 01` + 12 × u8 | Every slot's on/off (section 5 at 724) after a footswitch press | Hardware capture: one bit changes per press, matching section 8 | High |
| `08 00 05 01` + 18 bytes `07 FF FF 00 FF FF 00 00 \| 00 00 C8 42 \| 00 × 8` | Unknown (holds f32 100.0; expression pedal or toe switch?) | Once, hardware capture | Low |
| `01 00 0A 01` + u32 index | Preset changed on the unit | Hardware capture | High |
| `04 00 04 01` + 156 bytes | The assignment tables after a chain edit: section 2 bytes 4..9 or 4..8, section 7 from 5 or 4, section 8 rows (from 9): 6 + 90 + 60 or 5 + 91 + 60 bytes. Sent before the chain notice on add, remove and change model, not on a move | Captures 2, 3, 4: always the empty tables of an empty preset, so the one-byte ambiguity stays | High (content), medium (which byte is left out) |
| cmd `11`, `00 08 00 00` + u32 | "Preset edited" flag: 1 after an edit, 0 after a save | 1 after edits (hardware capture, capture 2); 0 sent 60 ms after the save in capture 1 (so a save does get this one notice); the editor reads it on connect (flag-1 `11` read) | Medium |
| cmd `11`, `00 52 00 00` + u32 | Unknown flag, toggled 1, 0, 1 within 4 s while nothing else was sent | Capture 2 (unit side only) | Low |

### Other connect reads (flag 0, no argument)

| cmd | Size | What we see | Confidence |
|-----|------|-------------|------------|
| `11` | 52 | Bytes, small values (`02`, `01`, `32` = 50, `0C` = 12, `FF FF`): global settings? | Low |
| `13` | 10 | `00 00 07 00 00 00 3C 00 00 5D` | Unknown |
| `16` | 124 | 31 float32: 1, 80, 0.71, then groups of (on, frequency, Q, gain) such as (1, 250 Hz, 1, -1), (1, 5000 Hz, 1, 1), (0, 20000 Hz, 0.71, 0): a global EQ? | Low |
| `16` (flag 1, `01 00 00 16`) | 8 | `00 00 00 00 01 00 00 00` | Unknown |

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

Whole presets (experimental, **not yet checked on the owner's unit**; see "Whole-preset write"):

- `matribox_export_preset`: the loaded preset (unsaved edits included) or a slot, written as a
  `.prst` in `~/.pocket-master-editor/presets/matribox`. Sends only reads; never replaces a file.
- `matribox_import_preset`: a `.prst` from that folder loaded whole into the loaded preset. With
  `preset` and `confirm` (the same label) it is also saved there, after the usual backup.
- `matribox_restore_backup`: a backup `matribox_save_preset` wrote, loaded whole and saved back to
  its own slot (`confirm` repeats its label; that slot is backed up again first).

File names are resolved inside their folder: `..`, absolute paths and other extensions are refused.

## Whole-preset write

Capture mb-20 (the owner's unit, 2026-11-24): the official editor importing a `.prst` into 57D
(index `0xE3`). It selected 57D, read it, then sent the whole preset in **one message**:

- Host → unit: type `12`, **flag 2**, cmd `10`, data = **1211 bytes**: u32 index (`E3 00 00 00`) +
  the 1207-byte body, the shape a preset read returns, in three pages of 183 bytes (above). The
  body carries the `.prst` section tag `0x10000002` in all 9 sections (a read shows `0x10000000`):
  the "`02` where reads have `00`" bytes at data offsets 4 and 23 are the first two tags. The editor
  compressed it for real; our literal-only stream is valid LZO1X too, in 7 pages.
- Unit → host: flag 0, cmd **`17`**, data `02 00 00 10`. The answer to wait for.
- The editor then read the current preset number and the preset: the new one, with the unit's own
  section tag. Sections 0, 2, 3, 4, 5, 7 and 9 came back byte for byte; section 1 differed only in
  its junk bytes (4..7 and the float noise from 28) and section 8 only in its junk (4..8).

`mbWritePreset(index, preset)` (core) builds it from any parsed preset (unit, backup, `.prst`):
`mbPresetBody` gives the body with the `.prst` tags, `buildMbFrames` the pages. Checked out of the
repository against capture mb-20: the data we build from the captured preset is the captured data
byte for byte, and the captured pages pass our checksum. The capture's data is not in the
repository (the preset may come from a commercial pack); the tests rebuild the shape from the
owner's "Drive AD" and keep only the capture's frame heads.

This one write carries everything: chain, parameters, on/off, the knob (sec2), expression-pedal
(sec7) and footswitch (sec8) assignments, the patch volume and tempo (sec5 at 736 and 738) and the
style tag.

**The write stores the slot it names** (owner's capture "midi para 1,2,3", 2026-11-24, official
app): a `.prst` imported into 58D was still there after loading 59D and coming back, with no save;
importing into 59B, the app then sent a save (cmd `05`) only to give the slot its name. So the MCP
server treats it as destructive, like a save: `matribox_import_preset` and
`matribox_restore_backup` need the slot and `confirm` with its label, back that slot up, load it
(select), write it, read it back (sections 2, 3, 4, 5, 7 and 9 must match), and send a save only
when the name given differs from the preset's. Our write is the official app's data uncompressed
(7 pages instead of 3); it is still to be checked on the unit.

`writeMatriboxPrst` (core) is the inverse of `parseMatriboxPrst`: `mbPresetBody`, a literal-only
LZO1X stream, a JSON byte array, base64. Whether the official editor opens a `.prst` written this
way is still to be checked.

## Writes

Every write but the whole preset (below) is a flag-1 message in a type `12` frame, its data a literal-only LZO1X stream. The
unit echoes set param, on/off and select back as a type `00` message (it may compress the
echo); it answers a chain edit with its **chain notice** instead (below), and a save with nothing. Host frames from captures
1, 3 and 4 (MIDI Monitor spying on output to the unit); capture 2 recorded only the unit's side.
Builders in `packages/core/src/matribox/write.ts`; tests compare them with the captured frames
(`packages/core/test/fixtures/matribox-chain-edits.txt`, `matribox-writes.txt`).

| Write | cmd | Data | Evidence |
|-------|-----|------|----------|
| Set param | 10 | `01 00 05 01` + u32 slot + u32 param ID + f32 value | Host frames, byte-exact; owner's unit ✓ |
| On/off | 10 | `02 00 05 01` + u32 slot + u32 0/1 | Host frames, byte-exact; owner's unit ✓ |
| Select | 10 | `01 00 0A 01` + u32 index (60D = 239) | Host frames, byte-exact; owner's unit ✓ |
| Add block | 10 | `01 00 04 01` + `FF` + u8 position + u8 module + u32 fxid | Host frame (capture 4); owner's unit ✓ |
| Move block | 10 | `01 00 04 01` + u8 from + u8 to + `FF` + `FF FF FF FF` | Host frame (capture 4); owner's unit ✓ |
| Remove block | 10 | `01 00 04 01` + u8 position + `FF` + `00` + `00 00 00 00` | Host frame (capture 4); owner's unit ✓ |
| Change model | 10 | `02 00 04 01` + u8 slot + u8 module + u32 fxid | Host frames (capture 3); owner's unit ✓ |
| Save | 05 | u32 index + 17-byte name (NUL-padded) | One host frame; owner's unit ✓ |
| Whole preset | 10, **flag 2** | u32 index + 1207-byte body (`.prst` tags), paged | Host pages (capture mb-20); answered by cmd `17`; not yet sent by us |

- Set param and on/off address the **storage slot**, not the chain position (capture 2: the delay
  was slot 1 while first in the chain). Add, move and remove take **chain positions** (0-based):
  "from" `FF` adds, "to" `FF` removes. The unit picks the storage slot of an added block.
- Change model takes the **storage slot**, like set param and on/off (checked on the owner's unit
  with a block in slot 0 at position 2). The unit loads the new model's defaults by itself.
- **Chain notice**: after a chain edit the unit sends `00 00 04 01` + sec4 from byte 4 (order,
  module per slot, u32 fxid per slot) + 12 on/off bytes + 1 byte (the slot touched, `FF` for a
  move), often after a 160-byte `04 00 04 01 …` message (likely the expression-pedal and footswitch
  tables). Both are the unit's, never sent by the host: an earlier reading of capture 2 took them
  for writes, and the unit ignores them (checked on the owner's unit, 2026-11-24).
- **Save** stores the loaded preset (edits included) in the slot and gives it the name; the loaded
  preset takes the name too. The unit sends **no answer** (no echo; only the "preset edited" flag notice going to 0,
  see [the unit's own messages](#the-units-own-messages-unsolicited)), so we check a save by
  reading the slot back: its name in the preset list, its chain (sec4) and its parameters (sec5). Checked on the
  owner's unit (59D, 2026-11-24). Reading the loaded preset's own number returns the edit buffer, so
  the backup taken before saving over the loaded slot holds the edits, not what was stored.

Every write above but the whole preset has been checked on the owner's unit (2026-11-24).

## Editor (web and desktop)

The editor opens the plugged-in pedal by itself and picks its editor by the MIDI port name (`pedalOfPort`, core): a `Matribox II PRO` port
opens the Matribox editor, a `Pocket Master` port the Pocket Master's, which comes first when both
are plugged in (an open connection is kept until its pedal is unplugged; see `findPedal` in
`apps/web/lib/midi.ts`). The Matribox editor (`apps/web/components/Matribox*.tsx`, `lib/useMatribox.ts`,
`lib/matribox.ts`) talks through core's `matriboxLink`, the same request rules as the MCP server,
and sends only the official editor's reads and the core write builders, one request at a time.
A parameter drag sends only the newest value once the previous write is confirmed. After a chain
edit or a preset select it reads the loaded preset again. Save reads the slot, keeps it as a
backup in the browser (localStorage, newest 20, same JSON as the MCP server's backups), sends the
save and reads the slot back. The catalog: in the browser the owner picks his own `alg_data.json`
and it is kept in IndexedDB; the desktop app serves the installed one (or `MATRIBOX_CATALOG`) at
`app://editor/matribox-catalog.json`. The e2e tests (`apps/web/e2e/matribox.spec.ts`) run the
editor against the simulated unit with an invented catalog.

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
