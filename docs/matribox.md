# Sonicake Matribox II Pro (in progress)

The goal: an MCP server where you describe a tone and the AI builds it on the Matribox II Pro,
like the Pocket Master server does today. What exists so far is the protocol groundwork in
`packages/core/src/matribox/` (framing, pages, LZO1X, messages, name tables) and the model
catalog reader. No editor UI and no
MCP tools yet.

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
re-read. Saving and renaming were not captured yet.

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
| 1 | 10 | `01 00 0A 01` | 8 bytes: the argument, then u32 LE current preset number (66) |
| 0 | 10 | `43 00 00 00` | A preset, 1211 bytes ("Drive AD"; see below) |
| 1 | 11 | `00 08 00 00` | 8 bytes: the argument, then `00 00 00 00` |
| 0 | 14 | none | User IR names, 500 bytes. `mbReadIrNames()` |
| 0 | 18 | none | Capture (clone) names, 252 bytes. `mbReadCloneNames()` |
| 0 | 11 | none | 52 bytes, not decoded (global settings?) |
| 0 | 13 | none | 10 bytes `00 00 07 00 00 00 3C 00 00 5D`, not decoded |
| 0 | 16 | none | 124 bytes of float32 values, not decoded |
| 1 | 16 | `01 00 00 16` | 8 bytes `00 00 00 00 01 00 00 00` |
| 0 | 10 | `42 00 00 00` | A preset again, 1211 bytes, "Drive AD" |

The preset read's argument is a u32 that the reply's first 4 bytes repeat. `42` (66) is the current
preset; the first read asks for `43` and also gets "Drive AD" (preset 67 is "Cry&Cry"), and the two
replies differ in one byte (offset 37: `00` / `80`), so `43` may mean the edit buffer. Not confirmed.

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

A preset (1211 bytes decompressed) starts with its u32 number and is a list of sections. A
Matribox `.prst` file is base64 of a JSON byte array that is itself a raw LZO1X stream (no message
header), the same format. Parsing presets is the next step.

## Phases

The same gates as the Pocket Master: each phase is validated by the owner on his unit before the
next one starts.

1. **Read only:** connect, read device info, preset names, the current preset. Nothing sent but
   the read requests the official editor sends.
2. **Live edit:** parameter and block writes (`12` frames), with the original read and kept first.
3. **Save:** writing presets to slots, with a backup of every slot it overwrites.
4. **MCP tools:** describe a tone, the assistant builds it on the unit.

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
