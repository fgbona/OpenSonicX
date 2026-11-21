# Smart Box support (2.0.0): what we know before the first session

Desk research, no Smart Box connected yet. The owner bought one on 2026-11-21; 2.0.0 starts after
0.14.0 and 1.0.

## Where the knowledge comes from

SonicMaster (MIT) edits both Sonicake pedals and treats the **Smart Box as the full device and the
Pocket Master as a subset**: its `device_capabilities.json` restricts the Pocket Master to a list
of effect ids and leaves the Smart Box unrestricted. Its command and effect libraries describe the
Smart Box. That explains what we found on the Pocket Master in 0.12.x: the SonicMaster settings and
controls this pedal ignored are Smart Box features.

Device detection in SonicMaster is a case-insensitive match on the port name: USB `smart box`,
Bluetooth `smart box ble` or `smart box`. Ours matches only `pocket master` (core, web, MCP), so
today the editor would not see a Smart Box at all. The read-only probe script already matches both.

## Probably Smart Box only (to confirm on the unit)

Things removed from the Pocket Master editor because firmware V1.3.3 ignored them; likely real on
the Smart Box. The core still holds their frames.

| Feature | Frame / record | Removed in |
|---|---|---|
| Sync and Trail (mod/delay tempo sync, delay trails) | effect params | #55 |
| Per-block footswitch ("stomp mode") | `11 4D` | #56 |
| USB recording mode dry/wet, re-amp | globals | #59 |
| EXP/FS jack type and targets, ECO, battery only | globals | #60 |
| Preset BPM | record `0x2002`, `11 42 02` | #43 |

Models SonicMaster offers on the Smart Box but not on the Pocket Master (by id):

- FX1/FX2 modulation: 119-127 (Fullchor, Phaser ST, Crystal Chorus, C-Wah, Whirlcho, Jet,
  Flanser, Phaser M, Vibrato ST) and 601-603 (BBD Phaser, Lofi Vibrato, Flanger ST)
- Amps: 323-338 (Doctor CL/OD, Flyman B1, Calif IIC+/Star CL/IV LD/Bass, Supero 2 OD, Bog SV CL,
  Bog XT M, Superb CL/OD, Brit 900/50, Dizzy VH+, Tanger R100)
- Cab: 421 (Bass 4x10)
- Delays: 710-716 (Flash, Damage, Flutter, Glost, Dark, Shiny, Echo)

## Model data

Settled by the owner (2026-11-21): the Smart Box models' parameters, ranges and defaults come
from the same source as the Pocket Master catalog, credited as it is today in NOTICE. Each
model is still checked against the unit before it ships.

## First session with the Smart Box (read only, ~10 min)

1. Plug it in by USB, close other editors, run `node apps/mcp/scripts/probe-pedal.ts`. The report
   (in `~/.pocket-master-editor/probe-<time>.txt`) shows the port name, the firmware record, the
   current preset and the settings reply.
2. Run it again with `--scan` to list which query kinds answer.
3. Note the firmware version shown on the unit and the Bluetooth name it advertises.

No writes until that report is read: the settings reply decides which globals exist, and the
current preset shows whether the chain and model ids match the table above.

## Likely shape of 2.0.0 (not decided)

- A device model next to the link (`pocketMaster` / `smartBox`), detected by port name, with the
  catalog filtered per device as SonicMaster does.
- The removed features come back for the Smart Box only, each after a write and read-back on it.
- Global options, MCP tools and the assistant's model list follow the detected device.
- Preset files carry the device, so a Smart Box preset is not loaded into a Pocket Master.
