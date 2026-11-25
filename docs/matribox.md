# Sonicake Matribox II Pro (in progress)

The goal: an MCP server where you describe a tone and the AI builds it on the Matribox II Pro,
like the Pocket Master server does today. What exists so far: the protocol groundwork in
`packages/core/src/matribox/` (framing, pages, LZO1X, messages, name tables, the preset decoder),
the built-in model catalog, and the MCP server (below): the read tools, and **experimental** write tools
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
  the official editor's whole-preset write (capture mb-20) and the 69 pages of the IR and capture
  uploads (mb-17, mb-19), whose length and offset bytes are not summed. The unit's replies use
  another rule, not decoded yet: we keep their checksum and do not check it.
- **Host pages:** the whole-preset write and the IR and capture uploads are the host messages
  longer than one frame: pages of **183** decoded bytes (380-byte frames), each with the total
  length and its own offset, like the unit's 185-byte reply pages. `buildMbFrames` (core) pages a
  host message that way (it rebuilds the 23 pages of the IR upload byte for byte).
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
| 4 | 16 | Module index per slot (catalog module `index`: DYN 0 … VOL 15), `FF` = unused |
| 4 | 28 | u32 fxid per slot (catalog model `fxid`). IR `0x0A1000nn` = user IR nn, CLONE `0x0F00000n` = capture n |
| 5 | 4 + slot × 60 | 15 float32 per slot, indexed by the catalog parameter `id`, in real units |
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

Row 0 is footswitch A: the official editor's footswitch write (capture mb-09, the unit in stomp mode)
takes switch 0 for A, and our reading of a row is `9 + switch × 12 + slot` (high for A, medium for
B..D). Row 4 is not known (low): five rows for four switches A–D, so it may be the CTRL/external
switch. Rows 3 and 4 are identical in 21 of the 24 presets that assign switches. The tools offer
A..D only.

### Rest of sections 1, 5 and 9; sections 0 and 3

| Section, offset | Type | Meaning | Evidence | Confidence |
|-----------------|------|---------|----------|------------|
| 1, 4..7 | 4 bytes | Junk (two reads of the same preset differ) | Device reads | High |
| 1, 24..94 | f32 noise | Junk: tiny floats (pairs of equal values), zero or -0.0 in files | Two reads of "TESTE OSX": noise, then all zero | High |
| 5, 736 | u16 | Patch volume, 0..100: 45..90 per preset (45, 50, 60, 63, 70, 90 seen) | Capture mb-01: the preset read before the drag holds 50 and the editor's `03 00 05 01` volume write started at 52 (no read after it) | Medium-high |
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
| `03 00 05 01` + u32 value | Knob 3 turned: values 42, 82, 83, 52, 53 (0..100). The patch volume: the official editor's volume slider sends this same message (capture mb-01) | Hardware capture, mb-01 | High |
| `07 00 05 01` + 12 × u8 | Every slot's on/off (section 5 at 724) after a footswitch press | Hardware capture: one bit changes per press, matching section 8 | High |
| `02 00 05 01` + u32 slot + u32 0/1 | One block toggled on the unit: same shape as the host's on/off | Capture mb-17c (both sides): slot 1 off, then on 1.7 s later, no host frame around them, after a "preset edited" notice. Why this one and not the bulk `07` message (stomp mode, a CTRL switch, the touch screen?) is not known | High (layout), low (trigger) |
| `08 00 05 01` + 18 bytes `07 FF FF 00 FF FF 00 00 \| 00 00 C8 42 \| 00 × 8` | Unknown (holds f32 100.0; expression pedal or toe switch?) | Once, hardware capture | Low |
| `01 00 0A 01` + u32 index | Preset changed on the unit | Hardware capture | High |
| `04 00 04 01` + 156 bytes | The assignment tables after a chain edit: section 2 bytes 4..9 or 4..8, section 7 from 5 or 4, section 8 rows (from 9): 6 + 90 + 60 or 5 + 91 + 60 bytes. Sent before the chain notice on add, remove and change model, not on a move | Captures 2, 3, 4: always the empty tables of an empty preset, so the one-byte ambiguity stays | High (content), medium (which byte is left out) |
| cmd `11`, `00 08 00 00` + u32 | "Preset edited" flag: 1 after an edit, 0 after a save | 1 after edits (hardware capture, capture 2); 0 sent 60 ms after the save in capture 1 (so a save does get this one notice); the editor reads it on connect (flag-1 `11` read) | Medium |
| cmd `11`, `00 52 00 00` + u32 | Unknown flag, toggled 1, 0, 1 within 4 s while nothing else was sent | Capture 2 (unit side only) | Low |

**Following the unit.** `parseMbNotice` (core, `notice.ts`) decodes the rows above marked high
(preset change, `02` and `07` on/off, knob 1/2 set param, knob 3 volume, the "preset edited" flag);
tested on the captured frames (`packages/core/test/fixtures/matribox-notices.txt`). The link hands
every message no request took to `onNotice` (between requests too). The preset-change notice has
the bytes of the select echo and of the current-preset reply, so the link's own answers are taken
first. The web editor (`useMatribox`) re-reads the loaded preset when the unit loads another one
(once: the unit sends it twice) and applies the block, knob and volume notices to what it shows
without a read. Not followed yet: chain edits and saves made on the unit (never captured), the
expression pedal (`08 00 05 01`, not decoded) and the `00 52` flag.

### Other connect reads (flag 0, no argument): the global settings

The official editor's reads `02 11 08`, `04 11 08` and `07 11 08` (checksum, type, length) are the
argument-less flag-0 reads of cmd `11`, `13` and `16` (the checksum is the sum of the data nibbles:
`1+1`, `1+3`, `1+6`). The official editor's binary has a "global settings" window and names
requests for "global data" and "global EQ", and writes for both; its global EQ model has an on
switch, a volume and an output, a low cut (switch, frequency, Q), four bands (switch, frequency,
Q, gain) and a high cut (switch, frequency, Q). So these three tables are the globals.

**Every connect captured holds the same tables** (cap3, cap5, cap6 and mb-01, 2026-11-24), save one byte (cmd `11` byte 35, below). No capture changes a
global, and **no capture holds a host write to a global**: every host write captured is flag 1 or
2 cmd `10`, cmd `05`, or an upload (cmd `14`, `18`). So the write command is unknown and no global
write exists in core. The field layout below is a reading of one set of values against the manual's
list (firmware V1.2.2, "Global settings"): only the captures in
[matribox-captures.md](matribox-captures.md#global-settings-and-pedal-side-changes) can settle it.
No parser in core either: until a field is matched to a setting, it would only rename bytes.

**cmd `11`, 52 bytes** (the general settings). All bytes not listed are 0.

| Byte | Value | Reading | Confidence |
|------|-------|---------|------------|
| 2 | `02` | An enumeration: MIDI In Source "Mixed" (TRS, USB, Mixed = 2)? Input Mode? | Low |
| 5, 9 | `01`, `01` | Switches or enumerations (Input Mode E.GT = 1? Auto CAB on?) | Low |
| 11 | `32` (50) | A 0..100 level: AUX Level, or Brightness (the manual's screens show 50) | Low |
| 14 | `0C` (12) | Unknown (a dB level with an offset? display time?) | Unknown |
| 15, 20, 21, 22 | `01` | Switches or enumerations | Unknown |
| 35 | `00` in cap3 (the first session), `01` in cap5, cap6 and mb-01 | A setting the owner changed between those sessions: in mb-09 the unit was in stomp mode, so maybe Current Mode (Preset = 0, Stomp = 1) | Low |
| 44, 45 | `02`, `04` | Enumerations (Clock Source? USB mode?) | Unknown |
| 48, 49 | `FF FF` | "None" for two choices: EXT FS 1 / 2 tap functions? | Low |

The MIDI channels (Omni by default, four of them), the language, the display time and the
switches of the manual are among the zeros or the `01`s; nothing tells which yet.

**cmd `13`, 10 bytes**: `00 00 07 00 00 00 3C 00 00 5D`. Unknown: global tempo (switch and BPM)
is the manual's other global and 120 is not in it as a byte (`3C` = 60, `5D` = 93).

**cmd `16`, 124 bytes: the global EQ**, 31 float32 LE:

| Offset | Values | Reading | Confidence |
|--------|--------|---------|------------|
| 0, 4, 8 | 1, 80, 0.71 | Unknown head: on switch, volume or output? (the manual's level is 0..100) | Low |
| 12..27 | 0, 20, 0.71, 0 | Low cut: switch **off**, 20 Hz (its lowest), Q 0.71, an unused gain | Medium |
| 28..43 | 1, 250, 1, -1 | Band 1: switch, frequency (Hz), Q, gain (dB) | Medium |
| 44..59 | 1, 500, 0.71, 0 | Band 2 (the manual's default 500 Hz, Q 0.7) | Medium |
| 60..75 | 1, 1000, 0.71, 0 | Band 3 (default 1000 Hz) | Medium |
| 76..91 | 1, 5000, 1, 1 | Band 4 (default 5000 Hz) | Medium |
| 92..107 | 0, 20000, 0.71, 0 | High cut: switch off, 20000 Hz (its highest) | Medium |
| 108..123 | 1, 8000, 0.71, 50 | Unknown tail: 50 fits a 0..100 level, not a gain (±20 dB) | Low |

The (switch, frequency, Q, gain) groups match the manual's ranges and defaults; which end holds
the EQ's on switch and its level is open.

**flag 1, cmd `16`, argument `01 00 00 16`** (the editor's last connect read): `00 00 00 00 01 00 00 00`.
Unknown (the global EQ's on switch?).

## MCP tools

The MCP server in `apps/mcp` talks to whichever supported pedal is plugged in. The pedals are told
apart by their MIDI port name (`Pocket Master`, `Matribox II PRO`; `apps/mcp/src/devices.ts`). The
Pocket Master keeps its tools; the Matribox's start with `matribox_`, and nothing they send writes:

- `which_pedal`: which supported pedals are connected (it lists MIDI ports, nothing is sent).
- `matribox_list_presets`: the 240 presets by label, with style tags, the loaded one marked.
- `matribox_get_preset`: the loaded preset: chain in order, each block's model and the gear it is
  based on, on/off, parameters by name with their ranges; IR and CLONE blocks show the slot's name.
- `matribox_list_models`: the catalog by module (all 16, or one), with origins and parameter ranges:
  the palette the assistant plans a tone from. Built in (below): nothing to install.
- `matribox_list_irs`, `matribox_list_captures`: the user IR and capture slot names.
- `matribox_load_ir` (write, experimental): a WAV into a user IR slot; see "User IR and capture
  uploads".

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

Live controls (experimental, **checked on the owner's unit, 2026-11-24**: volume, footswitch
rows A–D and assignment, expression assignment and range, tuner, BPM, tap tempo, looper and drum
CCs; CTRL 1–4 and the quick-knob CCs were not tried; see "Live controls" and
"MIDI Control Change"):

- `matribox_get_assignments`: the loaded preset's patch volume, tempo, footswitch A–D blocks and
  expression entries (reads only).
- `matribox_set_volume` (0..100), `matribox_assign_footswitch` (A..D, a block, assign or not),
  `matribox_assign_expression` (entry 1..9, a block's parameter by name, min and max 0..100) and
  `matribox_set_expression_range`: SysEx writes, echoed; the assignments are read back.
- `matribox_tuner`, `matribox_tap_tempo`, `matribox_set_bpm` (40..300), `matribox_looper`,
  `matribox_drum`, `matribox_ctrl` (1..4), `matribox_quick_knob` (1..3): Control Changes on
  `channel` (default 1). Nothing comes back, so the answer says to check on the unit.

Whole presets (experimental, **checked on the owner's unit, 2026-11-24**: export, import into
57D, backup all (240 in 1 min 30 s) and a restore of three slots; see "Whole-preset write"):

- `matribox_export_preset`: the loaded preset (unsaved edits included) or a slot, written as a
  `.prst` in `~/.pocket-master-editor/presets/matribox`. Sends only reads; never replaces a file.
- `matribox_import_preset`: a `.prst` from that folder loaded whole into the loaded preset. With
  `preset` and `confirm` (the same label) it is also saved there, after the usual backup.
- `matribox_restore_backup`: a backup `matribox_save_preset` wrote, loaded whole and saved back to
  its own slot (`confirm` repeats its label; that slot is backed up again first).
- `matribox_backup_all_presets`: all 240 presets, each read with its slot loaded, in one file in
  `~/.pocket-master-editor/backups` (default `<time>-matribox-all.json`; see "Backup all").
- `matribox_restore_all_presets`: writes every preset of such a file back into its slot
  (`confirm: "ALL"`); by default all 240 are backed up to a new file first (`backup: false` skips it).

File names are resolved inside their folder: `..`, absolute paths and other extensions are refused.

## Reading a slot: the unit reads only the loaded one

Owner's unit, 2026-11-24: a preset read by index (flag 0, cmd `10`, u32 index: `mbReadPreset`)
returns the **loaded preset's edit buffer**, tagged with the requested index, whenever that index
is not the loaded one. Seen twice: an export of 58D while 3B was loaded gave 3B's "Chorus Clean",
and the backup taken before saving to 59D while 60D was loaded held 60D's "TESTE OSX". The
official editor never reads an unloaded slot: it selects it (`01 00 0A 01` + u32 index) and then
reads. The simulated unit (`packages/core/test/fake-matribox.ts`, shared by the core, MCP and web tests)
now behaves the same way.

So every read of a slot that may not be loaded selects it first (core `mbReadSlot`), which
discards the loaded preset's unsaved edits. What changed (MCP server and editor alike):

- **Save to another slot** (`matribox_save_preset`, the editor's Save dialog): the loaded preset
  (edit buffer, edits included) is read first; the target is selected and read (now what it
  stores) and that is the backup; the edit buffer is written into the target with the
  whole-preset write (`mbWritePreset`, which stores the slot it names) and read back (sections 2,
  3, 4, 5, 7, 9); a save (cmd `05`) follows only when the name changes. **The target stays loaded**
  (before, the slot that was loaded stayed loaded). If anything fails after the select, the edit
  buffer is kept too (MCP: a backup file of the slot that was loaded, `source: "edit-buffer"`;
  editor: in the backups list), so the edits are not lost.
- **Save over the loaded slot**: unchanged (backup, cmd `05`, read back). Reading what that slot
  stores would need a select, which would drop the very edits being saved, so its backup is the
  edit buffer as it was before the save, marked `source: "edit-buffer"` in the backup record
  (`"slot"` for one read with its slot loaded). To keep a restorable copy of what the loaded slot
  stores, back up before editing (export, or *Back up all*).
- **Export of a slot** (`matribox_export_preset` with `preset`): when it is not the loaded one it
  is selected, read, and the original preset selected again; unsaved edits of the loaded preset
  are lost. Exporting the loaded preset still reads the edit buffer (edits included).
- **Import and restore of one backup** (`matribox_import_preset`, `matribox_restore_backup`): the
  slot is selected before it is read for the backup (before, the backup was read first, so it held
  the edit buffer).

## Backup all

One file with all 240 presets (format: [docs/preset-file-format.md](preset-file-format.md#matribox-ii-pro-backup-all-file)).
*Back up*: remember the loaded index, then for each index select it and read it (1211 bytes), then
select the original index again (also after an error). *Restore*: the file is checked whole
first; then for each preset select its index, write it whole (`mbWritePreset`) and read it back
(sections 2, 3, 4, 5, 7, 9 must match); the first failure stops it with the slots already written;
then the original index is selected again. Both lose the loaded preset's unsaved edits (the
editor asks first when there are any). Before a restore, all 240 presets are backed up (MCP: a new
file in the backups folder; editor: downloaded), unless that is turned off. The preset names
come with the whole-preset write (section 1); the unit's preset list shows them without a save
(checked on the owner's unit: a restored slot took its name back).

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
(7 pages instead of 3); the unit takes it (checked on the owner's unit: an import into 57D was
stored and read back).

`writeMatriboxPrst` (core) is the inverse of `parseMatriboxPrst`: `mbPresetBody`, a literal-only
LZO1X stream, a JSON byte array, base64. Whether the official editor opens a `.prst` written this
way is still to be checked.

## User IR and capture uploads

Captured from the official editor (captures 17, 17b, 17c and 19, with the uploaded files at hand). Both are
flag-1 messages in paged write frames; the unit acknowledges with flag 3, the same cmd and
`u32 slot, u32 1, u32 0`, and the editor then reads the name table again. An empty slot is the one
whose name is still the default (`User IR 7`, `Clone 6`, …); the table's 8 bytes per slot are zero
for every slot, used or not.

**User IR, cmd 0x14, 4128 bytes:**

| Offset | Size | Meaning |
|--------|------|---------|
| 0      | 4    | Slot, 0-based (5 = the 6th) |
| 4      | 4    | 0 |
| 8      | 4    | Checksum (below) |
| 12     | 20   | Name, the file name cut to 16 characters, NUL padded |
| 32     | 4096 | 1024 samples, int32 LE in the int24 range, 44.1 kHz |

The samples are the WAV converted the way the official tool's native helper (`getNormalWav`) does
it, now reproduced sample for sample (`mbIrSamplesFromWav()`, checked against the capture by
`matribox-ir-capture.test.ts`, which runs only where the capture is):

1. JUCE reads the WAV's **first channel** as floats (an int24 sample becomes `s / 2^23`).
2. r8brain-free-src **1.6** `CDSPResampler24` resamples it to 44.1 kHz: 2x upsampling through a
   Kaiser-windowed linear-phase low-pass (transition band 2 %, 180.15 dB), then the 24-tap,
   673-position fractional-delay interpolator (`packages/core/src/matribox/r8b.ts`). The version
   and parameters come from the binary's symbol names and constants: `CDSPFracDelayFilterBank<24,
   673, 3, 8>`, `getInLenBeforeOutStart` and the 34/45 % intermediate bands exist only in 1.2-1.6,
   the `(filter, up, down, latency, bool)` convolver only from 1.6.
3. JUCE writes a 24-bit WAV (`Temporary.wav`): `round(f * (2^31 - 1)) >> 8`, ties to even.
4. The first 1024 samples are sent; there is no normalisation, fade or window.

No other rate was captured: 44.1 kHz files pass through unchanged (r8brain skips equal rates) and
every other rate is refused for now.

**Checksum (offset 8):** the byte sum (each byte 0..255) of the u32 slot, the u32 zero, the
20-byte name field and the first **1366** converted samples as int32 LE, of which only 1024 are
sent; a WAV shorter than that is padded with silence. It fits the three captured uploads exactly:
the real 48 kHz IR (mb-17, `0x000A7CD2`; 1366 is the only count that gives it), and two WAVs made
for it (48 kHz, 24-bit mono): all zeros (mb-17b, slot index 6, `0x05AE`) and one sample
`0x100000` then zeros (mb-17c, slot index 7, `0x028EB6`). Why 1366: ceil(1024 × 4 / 3) is a guess.
For 44.1 kHz files (no resampling) we take the same 1366 samples of the file; not captured.

The official editor compresses the message for real (LZO1X): the silence fits one page, the
impulse seven. The real IR was incompressible and went out as literals in 23 pages, which is what
we always send: `mbIrUpload(slot, name, wav)` (core) rebuilds that capture frame for frame, and the
data of the other two byte for byte (`matribox-ir-upload.test.ts`, with the two WAVs and their
captured frames as fixtures; the real IR's check runs only where the owner's files are).

**`matribox_load_ir`** (MCP, experimental until checked on the owner's unit): a WAV from
`~/.pocket-master-editor/irs` (44.1 or 48 kHz, `.wav`, resolved inside that folder) into user IR
slot 1..20, `confirm` repeating `IR<slot>`; the name defaults to the file name cut to 16
characters. It reads the IR names first: a slot whose name is not the default `User IR n` holds an
IR the unit cannot send back, so it is only overwritten with `replace: true`. It then sends the
pages, waits for the flag-3 acknowledgement (status 1 = stored, anything else is reported) and
reads the names again to check the slot took the name. The simulated unit acknowledges the same
way and renames the slot.

**Capture (clone), cmd 0x18, 8872 bytes:** u32 slot (9), u32 0, u32 byte sum of the `.clo`,
20-byte name (`5 RECTIFIER`), then an 8840-byte `.clo`: the same `VTSI` container as the Pocket
Master's (`packages/core/src/clo/codec.ts`; header and biquad identical). The official editor
compresses this message for real (LZO1X, 8377 bytes on the wire for 8880); the IR upload happens
to be all literals, like what we send. Not shipped: the `.clo` the official converter made from
`5 RECTIFIER.nam` is not what our converter (SonicMaster's port) makes from the same file and
reference DI: 1136 of 8840 bytes equal, gains `0.0858 / 0.0863 / 747.0 / 753.1` against our
`0.165 / 0.166 / 1124 / 1020`, arrayA and arrayB off by up to 0.73 and 0.39. The official
conversion is native code (`namConvertClo` in `HTUSBTools.dylib`), not ported.

### The official NAM -> `.clo` conversion (research, 2026-11-24)

**The capture is reproducible.** A small C harness (not committed) that `dlopen`s the installed
editor's `HTUSBTools.dylib`, calls `InitDartApiDL` with stub Dart functions and then
`namConvertCloData(callback, diWav, outWav, namPath, outBuffer, callback)` (no MIDI function is
touched) turns `5 RECTIFIER.nam` into an 8840-byte `.clo` in a few seconds that is **identical, byte
for byte, to the one in mb-19**. The conversion is deterministic and has no hidden input (unit
state, firmware, slot). `namConvertClo` (the file variant) writes the result through an
`std::ofstream` that is never opened and crashes outside the app; the `Data` variant copies it
into the caller's buffer.

**Same reference signal as ours.** The editor bundles `flutter_assets/assets/wavs/nam_input_wav.wav`
(70 s, 44.1 kHz, 16-bit, two identical channels, SHA-256 `9bb6c1b1…29aa1a`). Its first channel
divided by 32768 is SonicMaster's `nam_reference_di_44100.f32` sample for sample. So the DI,
its level and its length are ruled out: the difference is the algorithm.

**A different algorithm, not different parameters.** From the binary's symbols, call graph and the
debugger trace of one conversion:

1. `getConvertNormalWav(di, 48000)`: the DI resampled to the model's rate (48 kHz; JUCE +
   r8brain, as for the IRs) and cached as a 24-bit mono WAV
   (`~/Library/Caches/HTUSBTools/HTCache/48000.wav`).
2. `getNamOutput`: NeuralAmpModelerCore (`nam::get_dsp`, WaveNet/LSTM/ConvNet, Eigen) runs the
   model **once**, at the DI's own level, over the whole 70 s; the output is written as a
   **16-bit** stereo WAV at 48 kHz. There are no probe levels: SonicMaster (and so our port)
   runs the model five times, at 0.1, 0.03, 0.01, 0.003 and 1.0.
3. `HTKPA::init(48000)`, `setInputSignalPath(48000.wav)`, `setOutputSignalPath(nam output)`:
   both read into `70 * fs + 600`-sample float buffers (each must be at least 70 s at exactly
   `fs`).
4. `HTKPA::startClone()`, its own fit: remove the output's mean and linear trend, find the
   response onset, build per-segment envelope tables (max |input|, max/min output) and fit the
   asymmetric exponential saturator to them (a double-precision least-squares start, then a
   long unrolled `expf` search), then alternate 2x oversampled passes (`HT_IIRUpX2` ->
   saturator -> `HT_IIRDownX2`), FFT block convolutions (`convolverInit/ProcessMono`, Ooura and
   CMSIS `arm_rfft_f32`), transfer-function estimates (`tfestimate`), `smoothdata`,
   `HTKPA::iterAmpCoeff` (up to three rounds), `downSampleSmoothFreq`, `minPhaseIR`, and finally
   `convertSampleRate` of both FIRs to 44.1 kHz into the VTSI container. The arithmetic is
   float32 throughout, NEON-vectorised.

**Why nothing was shipped.** Rebuilding that byte for byte in TypeScript means matching, in
float32 and in the compiler's summation order: NAM's Eigen inference (whose output is then
rounded to 16 bits, so a one-ulp difference flips samples), Apple libm's `expf`, two FFT
libraries and r8brain, through an iterative fit that amplifies any difference. That is far past
a sensible effort, and a "close" result could not be verified: nothing short of the unit's sound
tells whether a near miss is good enough. Scaling our probe level does not converge either: the
official fit never sees more than one level, so its gains (0.0858 vs 0.165) come from another
estimator, not a 5.7 dB offset.

**Ways forward (owner's call):**

- *Use the installed official converter.* On a Mac with the editor installed, the harness above
  makes the exact `.clo` the editor would send; `matribox_load_capture` could then upload it
  (the builder is the 32-byte header + the `.clo`, all known). This depends on Sonicake's binary
  at run time (macOS only, breaks if they change the entry point), so it was not done without
  the owner's say.
- *Upload our own `.clo`.* Same container, different fit: whether the unit plays it well (or at
  all) is untested. One upload of our converter's `.clo` of `5 RECTIFIER` into a free CLONE slot,
  compared by ear with the official one, would settle whether exactness matters.
- *Port `startClone` approximately* (the stages above, decompiled further) and judge it by ear,
  not bytes.

**What would help from the owner:** (1) a yes/no on calling the installed editor's converter;
(2) an A/B by ear on the unit of the official `.clo` vs ours for the same NAM (ours could be
sent by an experimental tool); (3) for an approximate port, a second real capture of the
official upload of a different NAM (another architecture, e.g. a LSTM or a "lite" WaveNet), to
check the port on more than one model.

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
| Patch volume | 10 | `03 00 05 01` + u32 0..100 | Host frames (mb-01), byte-exact; not yet sent by us |
| Footswitch | 10 | `01 00 08 01` + u32 switch (A = 0) + u32 slot + u32 1/0 | Host frames (mb-09), byte-exact; not yet sent by us |
| Expression assign | 10 | `02 00 07 01` + u32 group + u32 position + u32 slot + u32 param + f32 min + f32 max (range ignored) | Host frame (mb-04), byte-exact; owner's unit ✓ |
| Expression min / max | 10 | `03 00 07 01` / `04 00 07 01` + u32 group + u32 position + f32 | Host frames (mb-04), byte-exact; owner's unit ✓ |
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

Every write above but the whole preset and the live controls has been checked on the owner's unit (2026-11-24).

### Live controls (captures mb-01, mb-04, mb-09)

The official editor streams the patch volume while its slider moves (`03 00 05 01` + u32, the
message knob 3 sends from the unit) and the unit echoes some of them; a footswitch box and the
expression pedal's assign, min and max are single writes, each echoed. Builders in
`packages/core/src/matribox/write.ts` (`mbSetPatchVolume`, `mbAssignFootswitch`,
`mbAssignExpression`, `mbSetExpressionMin`/`Max`), tested against the captured host frames
(`packages/core/test/fixtures/matribox-controls.txt`). `mbAssignments` (core) reads the volume,
tempo, footswitch rows and expression entries back from a preset.

- **Footswitch:** switch A = 0 (capture mb-09: assign A to slot 0, unassign it, assign A to
  slot 1). A switch can toggle several slots (one section 8 row). Captured in stomp mode only.
- **Expression assign:** settled on the owner's unit (2026-11-24; capture mb-04 had every field at
  0): u32 **group** (0 = EXP 1 mode A, 1 = mode B, 2 = EXP 2), u32 **position** in the group
  (0..2), u32 **slot**, u32 **parameter**, f32 min, f32 max. Entry = group × 3 + position, the
  order section 7 lists them in: (1,0,1,0) landed in entry 4 on slot 1, (0,0,1,1) in entry 1 on
  slot 1 parameter 1, and the pedal then swept that parameter. **The unit ignores the range in an
  assignment** (it applies 0..100 and echoes 0..100 back), so the official editor's way is the
  one to follow: assign, then send min / max (`mbExpressionWrites`). Min / max take the same group
  and position (checked: setting entry 4's range left entry 1 alone). Min and max are 0..100,
  stored as f32 in section 7 at 23 and 59. Removing an assignment was not captured.
- Unsaved edits, these included, are discarded when another preset is loaded. The tuner sends no
  SysEx at all (the official editor has no tuner traffic); it is a MIDI Control Change (below).

## MIDI Control Change

Sonicake's manual (firmware V1.2.2, "MIDI Control Information List") lists Control Changes the unit
acts on. They go over the same USB MIDI port as the SysEx, as plain 3-byte messages
`Bn cc value` on the unit's MIDI channel (global settings: Omni or 1..16), and only when its
"MIDI In Source" includes USB. The unit sends no answer. Switches read 0..63 as off (stop, post) and
64..127 as on (play, pre); we send 0 and 127. `MB_CC`, `mbControlChange` and `mbBpmControlChanges`
(core, `cc.ts`) build them; the links send one with `control()`. **None is checked on the unit yet.**

| CC | Values | Function |
|----|--------|----------|
| 0 | 0..1 | Bank MSB: 0 for 1A..30D, 1 for 31A..60D, then Program Change 1..120 |
| 7 | 0..100 | Preset (patch) volume |
| 11 | 0..100 | EXP 1 |
| 13 | switch | EXP 1 mode A / B |
| 16, 18, 20 | 0..100 | Quick-access knob 1, 2, 3 value (MSB) |
| 17, 19, 21 | 0..63 / 64..127 | Quick-access knob 1, 2, 3 one step down / up (LSB) |
| 22, 23 | any | Bank + / bank − |
| 24, 25 | any | Preset + / preset − |
| 26, 27, 28 | any | Bank +, bank −, bank (wait mode) |
| 29 | switch | Footswitch mode: preset / stomp |
| 43..54 | switch | Block 1..12 on/off |
| 58 | switch | Tuner on/off |
| 59 | switch | Looper on/off |
| 60, 61 | any | Looper record, auto record |
| 62 | switch | Looper stop / play |
| 63, 64 | any | Looper undo/redo, delete loop |
| 65, 66 | 0..100 | Looper recording volume, playback volume |
| 67 | switch | Looper placement post / pre |
| 68, 69 | 0..2, 0..127 | Preset BPM: MSB, LSB; BPM = MSB × 128 + LSB, 40..300 |
| 70 | any | Tap tempo |
| 71..74 | 0..127 | CTRL 1..4 |
| 92 | switch | Drum machine (menu) on/off |
| 93 | switch | Drum stop / play |
| 94 | 0..99 | Drum rhythm |
| 95 | 0..100 | Drum volume |

The manual's BPM example gives CC68 = 1 for both 128..255 and 256..300; with CC68's range 0..2,
256..300 is CC68 = 2 (we send `bpm >> 7`, `bpm & 127`). Program Change, bank, preset ±, EXP 1, the
footswitch mode and block on/off CCs are listed but not used: the SysEx writes above already do
those.

## Editor (web and desktop)

The editor opens the plugged-in pedal by itself and picks its editor by the MIDI port name (`pedalOfPort`, core): a `Matribox II PRO` port
opens the Matribox editor, a `Pocket Master` port the Pocket Master's, which comes first when both
are plugged in (an open connection is kept until its pedal is unplugged; see `findPedal` in
`apps/web/lib/midi.ts`). The Matribox editor (`apps/web/components/Matribox*.tsx`, `lib/useMatribox.ts`,
`lib/matribox.ts`) talks through core's `matriboxLink`, the same request rules as the MCP server,
and sends only the official editor's reads and the core write builders, one request at a time.
The page looks like the Pocket Master's. The chain is a wrapping grid of tiles (module drawing and
colour, model, an LED that switches the block, arrows, a last *Add* tile), laid out as a snake:
each row reads left to right and a cable behind the tiles bends from the end of one row to the
start of the next, so no sideways scroll. Dragging a tile is one move-block write plus the usual
read-back (`useTileDrag`, shared with the Pocket Master; touch keeps the arrows). A block's model
menu lists only its module's models grouped by the catalog's model types; *Add* asks for the
module, then the model. On a phone, Export, Import and Read fold under a ⋯ menu. The editor also
follows the unit: `MatriboxLink.onNotice` hands over what the unit sends by itself (see "The unit's own messages"), so a preset switch (one re-read), block on/off, knob 1/2 and the
patch volume show without a read. Status on the owner's unit: following the unit's own changes,
the tone library's Keep/Load and the snake with a long preset are **not yet checked** there.
The tone library (`components/MatriboxLibrary.tsx`): *Keep tone* reads the edit buffer and keeps
it in this browser (key `pocket-master-editor.matriboxLibrary.v1`) with a name and notes; *Load*
sends a kept chain to the loaded preset as one Undo step through the validated writes and never
writes a slot; the library exports to and imports from `matribox-library.json`.
The tone assistant uses the same library.
A parameter drag sends only the newest value once the previous write is confirmed. After a chain
edit or a preset select it reads the loaded preset again. Save reads the slot, keeps it as a
backup in the browser (localStorage, newest 20, same JSON as the MCP server's backups), and stores
the loaded preset as described in "Reading a slot" (another slot: whole-preset write, the slot
stays loaded; the loaded slot: save), then reads the slot back. *Back up all presets* and
*Restore all…* (section "All presets") download and read one backup-all file, with progress
("Backing up 12A", "Restoring 12A"); see "Backup all". One preset as a file
(`components/MatriboxPresetFile.tsx`, `lib/matriboxPresetFile.ts`): *Export preset* reads the edit
buffer (unsaved edits included; nothing is selected) and downloads `<label> <name>.prst`
(`writeMatriboxPrst`); *Import preset…* reads a `.prst` or a backup of one slot, shows its name
and chain, and after an explicit confirmation does what the official app does (see "Whole-preset
write"): select the target (the loaded slot by default), keep what it stores in the backups list,
write the preset whole, read it back (sections 2, 3, 4, 5, 7, 9). The target stays loaded, under
the name the file carries (no cmd `05`); unsaved edits of the loaded preset are lost, which the
dialog says. A Pocket Master `.prst` (515 bytes, starts with "Pocket Master") and anything else
that is not a Matribox preset are refused before anything is sent. It also shows the patch volume (a slider, newest value only, like a knob), a grid of which blocks
footswitches A–D toggle, the nine expression entries (block, parameter, min, max, Apply) and a
tuner / tap tempo / BPM row sent as Control Changes on a chosen MIDI channel; after an assignment
it reads the loaded preset again. Undo and Redo cover the chain edits only (the history replays
chains). The model catalog is built in (below): nothing is picked or loaded. The e2e tests
(`apps/web/e2e/matribox.spec.ts`) run the editor against the simulated unit with it.

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

The models and their parameters (16 modules, 267 models) are built in, in the web app, the PWA,
the desktop app and the MCP server; nothing has to be installed, picked or loaded. Core exports
them as `MB_CATALOG`, built by `mbCatalog(map, text)` from two files of ours:

- `packages/core/src/matribox/models.json`: a clean functional map, only what the protocol needs,
  in our own structure. It is written by `scripts/matribox-map.mjs` from a local copy of the
  official editor's `alg_data.json` (`node scripts/matribox-map.mjs <path>`); that file is never
  committed or shipped, and the script keeps none of its descriptions, parameter help, notes,
  legal notice block or model display names (it refuses to write any key outside the schema).
- `packages/core/src/matribox/model-text.json`: our own short name for each model and our own
  description in English and Portuguese, keyed `"MODULE:fxid"` (e.g. `"DRV:50331648"`). The UI
  shows the description in its language; the MCP server and the assistant read the English one
  (the web assistant the one of the UI).

Schema of `models.json` (version 1):

```
{
  "version": 1,
  "modules": [                       // by module index
    {
      "module": "DRV",               // module code
      "index": 3,                    // module index in the protocol (DYN 0 … VOL 15)
      "models": [                    // by model index
        {
          "fxid": 50331648,          // model id the unit reads and writes
          "index": 0,                // position in the module's list
          "type": "OD",              // our category, groups the model menus ("" when none)
          "basedOn": "…",            // the real gear, plain text on one line ("" for originals)
          "params": [                // by id
            {
              "id": 0,               // parameter slot (index of the preset's 15 values)
              "label": "Gain",       // generic control name
              "min": 0, "max": 100, "step": 1, "default": 50,
              "options": ["Off", "On"]   // only for a switch or a list, one label per step
            }
          ]
        }
      ]
    }
  ]
}
```

Core tests check that `models.json` holds only the keys of this schema (none of the source's texts or names) and no trademark signs, that every
model has our text (names unique per module, none carrying a brand or model token of real
gear), and the generator on synthetic input. Names of real gear are trademarks of their owners,
used only to describe the sound (see NOTICE). Tests of the editors use small invented catalogs
in the same schema (`packages/core/test/matribox-fake-catalog.ts`).

## Clean room

Community projects about this unit exist online, but none has a license, so none of their code is
used here. Reading them for ideas is allowed; the code is our own, written from our captures.
