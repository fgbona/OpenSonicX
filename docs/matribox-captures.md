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
| 11 | `mb-11-knob-assign.mmon` | Change the target of one of the unit's three knobs (quick knobs / CTRL), if the editor offers it. Read-back | The knob-assignment write; section 2 layout; what knob 3's target `0D` means |
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
| 22 | `mb-22-global-eq.mmon` | Global settings: change one global EQ band (e.g. 1 kHz gain 0 → +3 dB), if the editor has a global EQ | Which part of the cmd `16` 124-byte table it is, and the write for it |
| 23 | `mb-23-global-setting.mmon` | Global settings: change one other setting (e.g. input level, output mode, MIDI channel). Note which one and the values | The write for global settings; which byte of the cmd `11` 52-byte table it is |
| 24 | `mb-24-unit-preset.mmon` | No editor action: change preset with the unit's footswitches (up one, then back) | The unit's preset-change notice and whether the editor re-reads after it |
| 25 | `mb-25-edit-buffer.mmon` | On 60D: change one knob in the editor (do not save), select 59D, select 60D again | Whether unsaved edits survive a preset change; the "edit buffer vs stored slot" question of the preset reads |

The chain edits captured so far (captures 2 to 4 in matribox.md) only ever showed the assignment
tables (`04 00 04 01`) of an empty preset. Captures 4, 6 and 9 leave assignments in place, so
after them, **one chain edit** (add or remove a block on the same test slot) would also show which
byte the 160-byte table leaves out: call it `mb-26-chain-with-assignments.mmon`.
