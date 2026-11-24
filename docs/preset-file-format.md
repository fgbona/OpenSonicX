# Preset file format

A preset file (`.json`, made by **Export** in the editor or `export_preset` in the MCP server)
holds one preset exactly as the pedal sent it, so it can be kept, shared and loaded back.

```json
{
  "format": "pocket-master-preset",
  "version": 1,
  "name": "IRON-LEAD",
  "createdAt": "2026-11-18T22:30:00.000Z",
  "payload": "1241FF00…",
  "notes": "optional free text"
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `pocket-master-preset`. |
| `version` | Format version, `1`. |
| `name` | Preset name, up to 10 characters the pedal can show (may be empty). |
| `createdAt` | When the file was made, ISO 8601. |
| `payload` | The pedal's edit-buffer dump (reply to `12 41`), hex without spaces. Kept raw, so fields the editor does not decode yet survive a round trip. |
| `notes` | Optional free text, e.g. which record the tone matches. |

## Matribox II Pro: backup-all file

*Back up all presets* in the Matribox editor and `matribox_backup_all_presets` in the MCP server
write every preset of a Matribox II Pro (1A..60D) to one `.json` file; *Restore all…* and
`matribox_restore_all_presets` write them back. Core: `mbBackupAllPresets`,
`mbRestoreAllPresets`, `parseMbBackupAll` (`packages/core/src/matribox/backup-all.ts`).

```json
{
  "format": "opensonicx-matribox-backup",
  "version": 1,
  "device": "Sonicake Matribox II Pro",
  "createdAt": "2026-11-24T22:30:00.000Z",
  "presets": [
    { "index": 0, "label": "1A", "name": "Matribox II PRO", "preset": "00000000000000100B000000…" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `opensonicx-matribox-backup`. |
| `version` | Format version, `1`. |
| `device` | Always `Sonicake Matribox II Pro`. |
| `createdAt` | When the backup was made, ISO 8601. |
| `presets` | 1 to 240 entries, each index at most once; a backup holds all 240, a hand-made file may hold a subset. |
| `presets[].index` | 0..239. |
| `presets[].label` | `1A`..`60D`; must match `index` (four per bank). |
| `presets[].name` | The preset's name, for people; the name written back is the one inside `preset`. |
| `presets[].preset` | The 1211 bytes the unit sent for that slot once it was loaded (u32 index + 9 sections), hex without spaces. |

Restore checks the whole file before sending anything (format, version, device, date, entry
count, indexes, labels, that every preset is 1211 bytes and parses) and writes the presets in
file order, stopping at the first failure. The same stability rules as below apply.

## Stability

Version 1 is frozen for every 1.x release: a file written by any 1.x opens in every later 1.x.
A later 1.x may add optional fields; readers ignore fields they do not know. Anything else
(renaming or removing a field, changing what `payload` holds) means a new `version`, and the
editor keeps reading version 1. `packages/core/test/fixtures/preset-files/` holds files that the
tests read on every change.
