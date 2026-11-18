# Save to slot with backups (phase 3)

## Intent

The owner validated live edit on the pedal and asked for the last phase:
write the edit buffer to a user preset slot, always with a backup first.
The owner first chose both kinds of backup (a full backup of the 50 user slots
once per session plus a target-slot backup), then, after trying it on the pedal,
changed it to the target slot only, with a per-save checkbox to skip it.
A restore always backs up the slot it overwrites. `backupAllSlots` stays in
core, unused by the editor, for a possible future "back up all presets" action.

## Protocol facts that shape the design

- The pedal only dumps the preset that is loaded. Reading another slot means
  selecting it (`11 43`), which discards unsaved edits.
- Save is `11 4A u32 slot, char[10] name, 00 00 00`, user slots 0..49 only.
  The pedal answers `14 08 00` (ok) or `14 08 01` (failed).
- Names: `12 40` returns 100 records of `u32 slot, char[16] name` in 106
  packets (captured from the owner's unit).
- No known command writes a raw dump back. Restoring rebuilds the preset from
  what the editor understands (chain, models, on/off, parameters, preset
  volume) and then saves. Unknown dump fields (for example the probable tempo)
  cannot be restored; the backup file keeps the raw dump anyway.

## Flows

Edits in progress are carried: before any selection the edited preset and
its slot are kept in memory; afterwards the original slot is selected again,
re-read, and `diffPresets(fresh, edited)` is sent to bring the edits back.

1. **Session backup** (first save of a connection): read names; for each user
   slot select, wait, read current index (must match) and dump; return to the
   original slot and restore edits. Result: one JSON file downloaded and kept
   in the browser.
2. **Save to slot N with name**: session backup if missing; select N, read
   its dump as the target backup (file downloaded and kept); select the
   original slot back and restore edits; send `11 4A`; require the ok
   acknowledgement; verify by reading the names (name at N) and the dump
   (no diff to the edited preset). The new restore point is the saved preset.
3. **Restore a slot from a backup**: rebuild the backed-up preset in the edit
   buffer by diff, then save it with its backed-up name (through flow 2, so the
   current content of that slot is backed up first).

Any failure stops the flow, reports which step failed, and leaves the backups
already taken.

## Safety

- A third guarded send path, preset operations, accepts only `11 43` (select,
  any of 0..99) and `11 4A` (save, 0..49). The edit path still refuses both.
- Saving asks for confirmation that names the slot, its current name and the
  new name, and says that a backup is taken first.
- Factory presets (F01..F50) cannot be targets.
- Names are 1..10 printable ASCII characters.

## Approaches considered

1. **Flows in core over an abstract `Pedal` interface, tested against a fake
   pedal that simulates slots, edit buffer, selection and save** (chosen).
   The riskiest code is tested without hardware and the MCP reuses it.
2. Flows inside the React hook. Untestable without the browser and the pedal.
3. Back up by reading the edit buffer only. Cannot back up a slot that is not
   loaded, which the owner's choice requires.

## Backup file

`pocket-master-backup` JSON, version 1: created time, editor version,
`kind` (`session` or `slot`), and per slot: index, label, name, the raw dump
payload in hex and its decoded summary. Kept in browser storage (latest
session backup plus the last 20 slot backups) and always downloaded.
