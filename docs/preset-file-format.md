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

## Stability

Version 1 is frozen for every 1.x release: a file written by any 1.x opens in every later 1.x.
A later 1.x may add optional fields; readers ignore fields they do not know. Anything else
(renaming or removing a field, changing what `payload` holds) means a new `version`, and the
editor keeps reading version 1. `packages/core/test/fixtures/preset-files/` holds files that the
tests read on every change.
