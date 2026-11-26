# Matribox II Pro: captures still needed

Short MIDI Monitor captures of Sonicake's official editor that would settle what
[docs/matribox.md](matribox.md#unknown-sections) still marks medium, low or unknown. Each capture is
**one action**, so every message in it belongs to that action.

## Setup (once)

1. Plug in the Matribox, open the official editor and let it connect. Close OpenSonicX and anything
   else that opens the Matribox's MIDI port.
2. In MIDI Monitor, under **Sources**, tick **both**:
   - "Spy on output to destinations" → **Matribox II PRO** (shows as `To Matribox II PRO`),
   - MIDI sources → **Matribox II PRO** (shows as `From Matribox II PRO`).

   Both are needed: an earlier capture that had only the unit's side misled us once.
3. Load a test slot: **60D** ("TESTE OSX") unless the step says otherwise. Never use a slot you care
   about; 59D and 58D are free test slots too.
4. Save each capture as `~/.pocket-master-editor/matribox/captures/mb-NN-<name>.mmon` (the names
   below). Add one line to `captures/README.txt` saying what you did, with the values before and
   after (e.g. "patch volume 50 → 80").

## For each capture

1. Click **Clear** in MIDI Monitor.
2. Do the one action. Wait 3 seconds.
3. **Read-back** (when the step says so): disconnect the editor and connect it again (or quit and
   reopen it) while still capturing. Its connect reads dump the loaded preset with the change in it,
   so we get the bytes before (the previous read-back) and after.
4. Save the capture.

Do not save the preset unless the step asks for it. Never run a factory reset or a firmware update
during a capture.

## The captures

| # | File | Action (one only) | What it answers |
|---|------|-------------------|-----------------|
| 1 | `mb-01-patch-volume.mmon` | Preset settings: patch volume 50 → 80 (or from its value to +30). Read-back | The write that sets the patch volume; whether it is section 5 at 736 (u16) and the `03 00 05 01` message knob 3 sends |
| 2 | `mb-02-bpm.mmon` | Set the preset's tempo 120 → 100 BPM in the editor. Read-back | The tempo write; whether section 5 at 738 is the BPM and what 740 is |
| 3 | `mb-03-tap.mmon` | No editor action: tap tempo on the unit, 4 even taps at about 90 BPM | What the unit sends for tap tempo; whether the unknown `00 52` flag is tap-related |
| 4 | `mb-04-exp1-a.mmon` | Assign EXP 1 (mode A / volume side) to DRV Gain, min 10, max 90. Read-back | The expression-assignment write; section 7 entry layout; whether min/max are stored in percent or in the parameter's units |
| 5 | `mb-05-exp1-second.mmon` | Add a second EXP 1 mode A target (e.g. AMP Gain). Read-back | Whether entries 0..2 are the three targets of EXP 1 mode A |
| 6 | `mb-06-exp1-b.mmon` | Assign EXP 1 mode B (the toe-switch side) to a WAH parameter, then press the toe switch twice on the unit | Entries 3..5 = mode B; whether section 7 byte 4 is the active mode; the toe-switch notice |
| 7 | `mb-07-exp2.mmon` | If the editor offers EXP 2 (external pedal): assign it to RVB Mix. Read-back | Whether entries 6..8 are EXP 2 |
| 8 | `mb-08-exp-sweep.mmon` | No editor action: move the expression pedal slowly heel → toe → heel | The unit's expression-pedal message (maybe the unknown `08 00 05 01` one) |
| 9 | `mb-09-fs-assign.mmon` | Change what footswitch A toggles (stomp mode) to a different block. Read-back | The footswitch-assignment write; which section 8 row is switch A |
| 10 | `mb-10-fs-press.mmon` | No editor action: in stomp mode press A, B, C, D (and CTRL or the external switches if connected), in that order, 2 s apart. Note the order | Which physical switch each section 8 row is, and what row 4 is |
| 11 | `mb-11-knob-assign.mmon` | Change the target of one of the unit's three knobs (quick knobs / CTRL), if the editor offers it. Read-back | The knob-assignment write; section 2 layout; what knob 3's target `0D` means. Now taken from waveod (`01/02 00 02 01`, `0D` = volume): this capture would confirm it on the unit |
| 12 | `mb-12-knob-turns.mmon` | No editor action: turn knob 1, then knob 2, then knob 3 (and the MASTER knob), each a little, 2 s apart | Which slot and parameter each knob edits; what knob 3's `03 00 05 01` value is |
| 13 | `mb-13-rename.mmon` | Rename the loaded preset only (e.g. "TESTE OSX" → "TESTE REN"), without saving | Whether rename is its own message or only part of save (cmd `05`) |
| 14 | `mb-14-style.mmon` | Change the preset's style tag (e.g. "" → "Rock"). Read-back | The write for section 1 at 95; the list of style values |
| 15 | `mb-15-save-as.mmon` | Load 60D, then save it as 58D under the name "TESTE COPY" | Save to another slot: cmd `05` index meaning, the `00 08` notice, what the unit sends back |
| 16 | `mb-16-tuner.mmon` | Turn the tuner on (in the editor or on the unit), pluck the low E for 3 s, turn it off | Tuner on/off and pitch messages; whether `00 52` is the tuner flag |
| 17 | `mb-17-ir-upload.mmon` | Upload one short user IR (`.wav`) to an **empty** IR slot. Also note the file's size and sample rate | The upload command, its paging and size limits; the 8-byte header per slot in the IR name table |
| 18 | `mb-18-ir-delete.mmon` | Delete (or rename, if there is no delete) that same IR slot | The IR slot write; what the table holds for an empty slot |
| 19 | `mb-19-capture-upload.mmon` | Import a capture (clone) file into an **unused** capture slot, if the editor can | The capture upload command; the 8-byte header per capture slot |
| 20 | `mb-20-import-prst.mmon` | Import a `.prst` file into slot 57D | The **whole-preset write**: command, paging, whether it carries the 1207-byte body (and its section tags) |
| 21 | `mb-21-export-prst.mmon` | Export the loaded preset to a `.prst` file; keep the file next to the capture | Whether export reads anything new; lets us compare the file to the unit's read byte for byte |
| 22 | ~~`mb-22-global-eq.mmon`~~ (replaced: see [below](#global-settings-and-pedal-side-changes)) | Global settings: change one global EQ band (e.g. 1 kHz gain 0 → +3 dB), if the editor has a global EQ | Which part of the cmd `16` 124-byte table it is, and the write for it |
| 23 | ~~`mb-23-global-setting.mmon`~~ (replaced: see [below](#global-settings-and-pedal-side-changes)) | Global settings: change one other setting (e.g. input level, output mode, MIDI channel). Note which one and the values | The write for global settings; which byte of the cmd `11` 52-byte table it is |
| 24 | ~~`mb-24-unit-preset.mmon`~~ (replaced: see [below](#global-settings-and-pedal-side-changes)) | No editor action: change preset with the unit's footswitches (up one, then back) | The unit's preset-change notice and whether the editor re-reads after it |
| 25 | `mb-25-edit-buffer.mmon` | On 60D: change one knob in the editor (do not save), select 59D, select 60D again | Whether unsaved edits survive a preset change; the "edit buffer vs stored slot" question of the preset reads |

The chain edits captured so far (captures 2 to 4 in matribox.md) only ever showed the assignment
tables (`04 00 04 01`) of an empty preset. Captures 4, 6 and 9 leave assignments in place, so
after them, **one chain edit** (add or remove a block on the same test slot) would also show which
byte the 160-byte table leaves out: call it `mb-26-chain-with-assignments.mmon`.

## Global settings and pedal-side changes

**Done (2026-11-25):** mb-30 … mb-44 are decoded in [matribox.md](matribox.md#other-connect-reads-flag-0-no-argument-the-global-settings) and "The unit's own messages". Still open: mb-29 (baseline) was empty; mb-37 was taken on the unit (Global Tempo cannot be enabled from the official editor), so a host-side tempo change with Global Tempo already on (mb-37b) is wanted.

**Cross-checked (2026-11-26)** against zxmarcos/waveod and zxmarcos/matribox-studio (MIT): the EQ
words (cuts, shelves, the four bands), the Global Tempo writes (`25`, `26`) and the MIDI channel
index settled bands 1, 3 and 4 without a capture. Two readings changed: mb-34's write was `00 61`
(index 0, the **TRS** input, though the owner's field said USB), and mb-33's 1 is **Preset** (the
byte was 0 before the owner went Stomp → Preset). Wanted, to close them: `mb-46-midi-usb-ch.mmon`
(the official editor's MIDI channel fields, TRS and USB each Omni → 3, which byte moves for which)
and a look at the unit's GLOBAL page for Current Mode after a switch made from OpenSonicX.

What was open before the 2026-11-25 captures ([matribox.md](matribox.md#other-connect-reads-flag-0-no-argument-the-global-settings)):
the global tables (cmd `11`, `13`, `16`) are read on every connect but never changed in a capture,
and no host write to a global was ever captured. Rows 22 to 24 above are replaced by these, in
this order. Same setup and steps as above (both MIDI Monitor sources, Clear, one action, wait 3 s,
save). **Read-back** here means: quit the official editor and open it again while still capturing,
so its connect reads dump the global tables after the change. After each capture, put the setting
back and note in `captures/README.txt` the setting, the value before and the value after.

| # | File | Action (one only) | What it answers |
|---|------|-------------------|-----------------|
| 0 | none (a note) | On the unit, press GLOBAL and write down every value it shows, page by page (IN/OUT, Functions, USB Audio, EXP 2/Footswitch, Global EQ, MIDI, Display), without changing anything | The baseline: matches the values of the current tables (e.g. which setting is 50) |
| 30 | `mb-30-global-input-level.mmon` | Official editor, Global settings: Input Level from its value to +5 dB (or 0 → +5). Read-back | The global write command and its shape; the Input Level byte |
| 31 | `mb-31-global-aux-level.mmon` | Global settings: AUX Level 50 → 80. Read-back | Whether byte 11 (50) is AUX Level |
| 32 | `mb-32-global-brightness.mmon` | Global settings (Display): Brightness from its value to 80. Read-back | Whether byte 11 is Brightness instead; the Display fields |
| 33 | `mb-33-global-mode.mmon` | Global settings (Functions): Current Mode Stomp → Preset (or the other way). Read-back | Whether byte 35 (0 in the first session, 1 later) is Current Mode |
| 34 | `mb-34-global-midi-ch.mmon` | Global settings (MIDI): Input Ch (USB) Omni → 5. Read-back | The MIDI channel bytes (and so how Omni is stored) |
| 35 | `mb-35-global-midi-source.mmon` | Global settings (MIDI): MIDI In Source Mixed → USB Only. Read-back. **Put it back to Mixed** (or the editor's Control Changes stop) | Whether byte 2 (`02`) is MIDI In Source |
| 36 | `mb-36-global-input-mode.mmon` | Global settings (IN/OUT): Input Mode E.GT → Line. Read-back | Whether byte 5 or 9 is Input Mode |
| 37 | `mb-37-global-tempo.mmon` | Global settings (Functions): Global Tempo off → on, then its tempo 120 → 100. Read-back | Whether the 10-byte cmd `13` table is the global tempo |
| 38 | `mb-38-global-eq-band.mmon` | Global EQ: band 2 (500 Hz) gain 0 → +3 dB. Read-back | The global EQ write; confirms the band layout of cmd `16` |
| 39 | `mb-39-global-eq-level.mmon` | Global EQ: its level/volume from its value to 70, then its On/Off switch once. Read-back | The head (1, 80, 0.71) and tail (…, 50) of cmd `16`; the flag-1 `01 00 00 16` read |
| 40 | `mb-40-unit-preset.mmon` | No editor action (editor open and connected): on the unit, step to the next preset with the footswitches, wait 3 s, step back | Both sides of a preset change made on the unit: the notice (twice?) and whether the official editor re-reads after it |
| 41 | `mb-41-unit-stomp.mmon` | No editor action: unit in stomp mode, press footswitch A twice, 2 s apart; then the same with the touch screen's block on/off, if it has one | Which action sends the single on/off notice (`02 00 05 01`) and which the bulk one (`07 00 05 01`) |
| 42 | `mb-42-unit-knobs.mmon` | No editor action: turn quick knob 1, then 2, then 3, a little each, 2 s apart | Knob notices with both sides: whether the official editor answers them |
| 43 | `mb-43-unit-exp.mmon` | No editor action: move the expression pedal heel → toe → heel, then press its toe switch twice | The expression pedal's notice (`08 00 05 01`?) and the toe switch |
| 44 | `mb-44-unit-edit.mmon` | No editor action: on the unit, change the model of one block, then save the preset on the unit (to 60D) | Whether the unit sends its chain notice and a save notice for its own edits, so the editors can follow them |

Before mb-30, take one more: `mb-29-baseline.mmon`, nothing changed, just open the official
editor while capturing. Its connect reads are the "before" of every global capture (each setting
is put back after its capture, so they all start from the same tables).

## Decoding the captures

`apps/mcp/scripts/mb-capture.ts` decodes `.mmon` files offline with core's own frame, message and
LZO1X code; it never opens a MIDI port. From the repository root:

```sh
C=~/.pocket-master-editor/matribox/captures

# Every message, both sides: time, direction, read/WRITE/unit, flag, cmd, length, data
# (and the parseMbNotice reading of a notice)
node apps/mcp/scripts/mb-capture.ts decode $C/mb-30-global-input-level.mmon

# mb-30 … mb-39: for each capture, its host writes (the official app's global write) and which
# bytes and float32 words of the cmd 11, 13 and 16 tables changed against the baseline
node apps/mcp/scripts/mb-capture.ts diff $C/mb-29-baseline.mmon $C/mb-3[0-9]-*.mmon

# One capture alone: its first read-back against its last
node apps/mcp/scripts/mb-capture.ts diff $C/mb-38-global-eq-band.mmon

# mb-40 … mb-44: what the unit sent on its own (replies and echoes of a host message left out)
node apps/mcp/scripts/mb-capture.ts notices $C/mb-4[0-4]-*.mmon
```

Without a baseline capture, any earlier capture with connect reads works as the base (e.g.
`mb-01-volume.mmon`): the globals were the same in every connect since the first session. A
stream of writes of one kind (a slider drag) is shown as its first and last write and a count.
