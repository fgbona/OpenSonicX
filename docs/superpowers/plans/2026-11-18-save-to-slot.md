# Save to slot Implementation Plan

> Inline execution.

**Goal:** Save the edit buffer to a user slot after a full session backup and a target backup; restore slots from backups.
**Spec:** `docs/superpowers/specs/2026-11-18-save-to-slot-design.md`

## Global constraints
- Preset operations path: only `11 43` (0..99) and `11 4A` (0..49). Edit path unchanged.
- Every builder matches captures (presetCommands, presetVolume) or the documented save template.
- Core flows depend only on the `Pedal` interface.

## Review focus
- A failed or missing save acknowledgement must never be reported as saved.
- A selection that lands on the wrong slot (index mismatch) must stop the backup.
- Edits in progress must survive a session backup and a target backup.
- A backup failure must stop the save before `11 4A` is sent.
- Factory slots and bad names are refused before anything is sent.

### Task 1: Builders, guard, names (core)
`selectPreset(index)`, `savePreset(index, name)`, `encodeName`, `setPresetVolume(v)`, `isPresetOperation(sysex)`,
`decodePresetNames(payload)`, `decodeAck(payload)`; `volume` Edit kind. Tests against captures, the save
template and the owner's real names reply (`test/fixtures/names-capture.txt`).

### Task 2: Flows over a fake pedal (core)
`Pedal` interface; `backupAllSlots`, `backupSlot`, `saveToSlot`, `restoreFromBackup`; backup file format.
`test/fake-pedal.ts` simulates the unit by applying commands to dump bytes. Tests: edits survive, index
mismatch stops, nack and missing ack fail, verify step, factory slot refused.

### Task 3: Web
Link `presetOp` path with ack wait; hook `save`, `restore`, progress; Save dialog with confirmation; Backups
panel (download, restore); browser storage.
