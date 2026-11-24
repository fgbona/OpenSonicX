# Sonicake Matribox II Pro (in progress)

The goal: an MCP server where you describe a tone and the AI builds it on the Matribox II Pro,
like the Pocket Master server does today. What exists so far is the protocol groundwork in
`packages/core/src/matribox/` (framing, pages) and the model catalog reader. No editor UI and no
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

## Compressed payloads

The joined data of most replies starts with an 8-byte header, `[flag, 0, 0, cmd, length u32 LE]`,
followed by an LZO1X stream (`length` matches: e.g. 2964 for the 2972-byte preset list). Decoded
with liblzo2's `lzo1x_decompress_safe`: the preset list (2964 → 7444 bytes, 200 names in 17-byte
records), the current preset (351 → 1211 bytes), user IR names and capture names. 20-byte replies
are uncompressed acknowledgements. A Matribox `.prst` file is base64 of a JSON byte array that is
itself a raw LZO1X stream, the same format as the preset the unit sends. Decoding this in the core
is the next step; nothing decodes it yet.

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
