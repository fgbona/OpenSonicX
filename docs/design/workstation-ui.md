# Workstation UI (design proposal, branch `design/workstation-ui`)

Status: **proposal for the owner to evaluate**. Not for merge until approved.

The goal is an editor that feels like a multi-effects workstation (HX Edit, Tone Studio, Axe-Edit,
Neural DSP) and not like generic settings software. The pedal stays the source of truth: the screen
mirrors what the unit holds and makes every difference from it obvious.

## Principles

1. **The hardware is the truth.** Every edit is sent live to the pedal's edit buffer. What the UI
   calls *dirty* is "the edit buffer no longer matches the stored slot". It is shown three times:
   on the preset display (the sync chip), on the loaded entry of the preset list (an amber dot) and
   on each changed block (an amber dot on its tile).
2. **Signal chain first.** The chain is the main screen. Clicking a block opens its parameters in
   the contextual panel right under it, as HX Edit does.
3. **Music controls.** Knobs turn by vertical drag (Shift = fine), the scroll wheel and the arrow
   keys. Clicking the value (or Enter on a focused knob) lets you type a number. Double-click
   resets the default. Units come from the catalog (Pocket Master: dB, ms, Hz, cents). The
   Matribox catalog has no units yet, so it shows the unit's own numbers.
4. **Stage mode by default.** Dark, high-contrast, large targets (44 px minimum for buttons, list
   rows and the on/off LEDs, 72 px knobs). Usable with the guitar on your lap.
5. **Banks of three.** Presets are shown by bank. A name ending in `-CLEAN`, `-RHY` or `-LEAD`
   gets a coloured role chip. The save dialogs have three role buttons that rename the preset
   consistently (`MTL` → `MTL-CLEAN`, `MTL-RHY`, `MTL-LEAD`).
6. **Destructive actions confirm and back up.** This reuses what already exists: the save dialogs
   (overwrite confirmation + automatic backup), factory reset (two-step confirmation), restore all,
   and the clone/IR upload confirmation. Undo/Redo stays where it was (toolbar for the Pocket
   Master, preset display for the Matribox; Cmd/Ctrl+Z on both).
7. **Protocol stays apart.** No protocol code changed. `usePocketMaster` and `useMatribox` are
   untouched. A small read-only adapter (`lib/workstation/device.ts`) turns either hook's state
   into the same `DeviceView` (sync state, dirty blocks). The shared workstation components only
   read that view.

## Screen flow

```
             ┌───────────── no pedal ─────────────┐
 open app ──►│ Empty state: "Plug in your pedal"   │── pedal found (auto-detect, hot-plug) ──┐
             └─────────────────────────────────────┘                                         │
                                                                                             ▼
 ┌───────────────────────────────── Workstation (one page) ───────────────────────────────────┐
 │ Toolbar: brand · pedal · theme · language · connection · (PM: undo/redo/revert/save/…/⚙)    │
 ├──────────────┬─────────────────────────────────────────────────────────────────────────────┤
 │ Bank browser │ Rack nav:  Chain · Controls · Assistant · Library · Clones & IRs · Backups  │
 │  (presets)   │ Preset display (LCD) + sync chip + actions                                  │
 │              │ [Chain]       signal chain → contextual block panel                         │
 │              │ [Controls]    footswitches/CTRL · quick knobs · expression · MIDI · drums   │
 │              │ [Assistant]   AI tone assistant (+ TONE3000 sign-in)                        │
 │              │ [Library]     tone library · preset files (import/export)                   │
 │              │ [Clones/IRs]  captures (NAM/.clo) · user IRs                                 │
 │              │ [Backups]     backup all / restore all · backups list · AI connection      │
 └──────────────┴─────────────────────────────────────────────────────────────────────────────┘
   dialogs over the page: Save (overwrite + backup) · Copy · Global options/EQ (⚙) · Factory reset
```

The rack nav is a row of big anchor links above the preset display: every section stays on the
page (nothing is hidden behind tabs) and the nav jumps to it. It does not stick to the top yet (a
sticky bar would cover what it jumps to under the sticky toolbar). See trade-off T1.

## Main screen (Matribox, wide)

```
┌ OpenSonicX · Matribox II Pro ───────────────────────────── ☾  PT|EN  ● Matribox II Pro · USB ┐
├───────────────┬──────────────────────────────────────────────────────────────────────────────┤
│ PRESETS       │ ┌ LCD ────────────────────────────────────────┐  ↶ ↷  [Save…] ⋯   ◯ VOL 72  │
│ [search____]  │ │ EDIT BUFFER · (edited)                       │                              │
│ BANK 17  MTL  │ │ 17C  Drive AD                                │                              │
│  17A MTL-CLEAN│ │ ● EDITED · not stored in 17C                 │  ← sync chip                 │
│     [CLEAN]   │ └──────────────────────────────────────────────┘                              │
│  17B MTL-RHY  │ Chain · Controls · Assistant · Library · Clones & IRs · Backups              │
│     [RHY]     │ ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌───┐               │
│ ▶17C Drive AD●│ │DYN │─▶│DRV●│─▶│AMP │─▶│CAB │─▶│MOD │─▶│DLY │─▶│RVB │─▶│ + │  ●=edited     │
│  17D …        │ │gate│  │OD  │  │... │  │... │  │... │  │... │  │... │  └───┘               │
│ BANK 18       │ │▬▬▬▬│  │▬▬▬▬│  │▬▬▬▬│  │    │  │▬▬▬▬│  │▬▬▬▬│  │▬▬▬▬│  ▬=on/off LED       │
│  …            │ └────┘  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘                       │
│               │ DSP ▓▓▓▓▓▓░░░ 62 %                                                           │
│               │ ┌ 2. DRV block ───────────────────────────────── [Remove] (on/off) ┐         │
│               │ │ ▣ DRV  [Model ▾ OD-1 …]                                           │         │
│               │ │   ◯ 7.5     ◯ 50     ◯ 62                                         │         │
│               │ │   GAIN      TONE     LEVEL      click value to type · dbl-click=reset│        │
│               │ └───────────────────────────────────────────────────────────────────┘         │
└───────────────┴──────────────────────────────────────────────────────────────────────────────┘
```

Pocket Master: same layout. The toolbar keeps its live-edit tools (Undo, Redo, Revert, Save, Copy,
Tuner, Read, ⚙). The chain keeps the fixed DRV-AMP-IR-EQ unit, and the preset display keeps
Volume/BPM.

## Block panel (contextual)

```
┌ 3. AMP block ────────────────────────────────────────────────────────────┐
│ ▣ AMP  [Model ▾  <our name> <based-on gear>]                [Remove] (●) │
│ ┌ faceplate (amp skin, tube glow) ───────────────────────────────────────┐ │
│ │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                           │ │
│ │  │ 6.5  │ │  50  │ │  48  │ │ 1.2k │ │ -3dB │  ← value: click to type   │ │
│ │  │  ◯   │ │  ◯   │ │  ◯   │ │  ◯   │ │  ◯   │  ← drag ↕ / wheel / keys  │ │
│ │  │ GAIN │ │ BASS │ │ MID  │ │ FREQ │ │ VOL  │                           │ │
│ │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                           │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ model description                                                          │
└────────────────────────────────────────────────────────────────────────────┘
Knob typing:  [ 6.5▏ ]  Enter = send (clamped and snapped to the step) · Esc = cancel
```

## Preset / bank browser

```
PRESETS                      Pocket Master:  [Factory|User]  P01–P03 = bank 1, …
[ search          ]          Matribox:       the unit's banks, 1A–60D
BANK 12 · MTL                ← prefix shared by the bank's names
 12A  MTL-CLEAN   [CLEAN]    ← role chip from the name suffix (CLEAN/RHY/LEAD)
 12B  MTL-RHY     [RHY]
 12C  MTL-LEAD    [LEAD]
 12D  spare
BANK 13
 ▶13A Drive AD  ●            ← loaded preset; ● = edited, not stored
```

Save dialog: `Name [MTL-RHY____]  Role: [CLEAN] [RHY] [LEAD]` rewrites the suffix and keeps the
prefix (`MTL-RHY` → `MTL-LEAD`). The name length limit (Pocket Master 10, Matribox 16) is respected.

## Assistant

```
[Assistant] ┌ Tone assistant ───────────────────────────────────────────────┐
            │ provider/key · messages · "make it darker" … [Send]           │
            │ loads and saves go through the same confirmations as a person  │
            └───────────────────────────────────────────────────────────────┘
            TONE3000 sign-in (Pocket Master: its own panel; Matribox: in Clones)
```

## Clones and IRs

```
[Clones & IRs] ┌ Clones (10 slots) ─────────┐ ┌ User IRs (slots) ──────────┐
               │ 1 Plexi cap  [Upload…]     │ │ 1 V30 4x12  [Rename]       │
               │ NAM → .clo conversion      │ │ …                          │
               │ overwrite → confirm dialog │ └────────────────────────────┘
               └────────────────────────────┘
```

## Settings

Global options and EQ stay in the ⚙ dialog (Pocket Master) or the Global button in the preset
display's ⋯ menu (Matribox). Factory reset stays behind its two-step confirmation.

## Dirty and sync states

| State      | Chip (en / pt)                                          | When                                           |
|------------|---------------------------------------------------------|------------------------------------------------|
| `offline`  | No pedal / Sem pedal                                    | no unit connected                              |
| `reading`  | Reading from the pedal… / Lendo do pedal…               | connect, Read, preset load                     |
| `writing`  | Sending to the pedal… / Enviando ao pedal…              | an edit, save, upload in flight                |
| `synced`   | In sync with the pedal / Sincronizado com o pedal       | edit buffer = stored slot                      |
| `dirty`    | Edited · not stored in {slot} / Editado · não salvo em {slot} | edits not saved to the slot              |

```
Preset:  ● EDITED · not stored in 17C       (amber chip, also "●" on the list entry)
Block:   ┌────┐                             (amber dot at the tile's top-right, with an
         │DRV●│                              accessible "Edited, not stored" label)
         └────┘
```

Block dirtiness is the difference between the current edit buffer and the preset as last read or
saved: by module for the Pocket Master (its restore point), and by storage slot for the Matribox (a
snapshot the adapter takes whenever the unit reports "not edited"). A block moved but unchanged is
not dirty, and the preset still is.

## Trade-offs

- **T1. One page with a rack nav, not separate tabs.** Every panel stays mounted and reachable,
  and the existing flows (and their tests) keep working. The cost is a long page. Real tabs would
  hide panels and need new routing state.
- **T2. Restyle and reorganise, not rewrite.** The existing components (chain tiles, block panels,
  dialogs, assistant) keep their logic and accessible names. The new look comes from
  `app/workstation.css` (tokens + components) and a few new components. This is less "new" under
  the hood, but there is no risk to the protocol paths.
- **T3. No new dependencies.** Zustand is not needed: the UI state is a few `useState` calls and
  one read-only adapter. Adding a store would just add a library.
- **T4. Matribox units.** The catalog has ranges and defaults but no units, so values show as the
  unit's numbers. Units can be added to `models.json` later and the knob will show them.
- **T5. Banks of 3 vs the hardware.** The Matribox has 4 presets per bank (A–D) and the Pocket
  Master has none (P01–P50). The browser shows the hardware banks (Pocket Master: groups of 3).
  The CLEAN/RHY/LEAD roles come from the names, not from the position.

## Open questions for the owner

1. Matribox: should A/B/C be CLEAN/RHY/LEAD by position, and D a spare (or SOLO/FX)?
2. Role names: `CLEAN / RHY / LEAD` exactly, or also accept `CRUNCH`, `SOLO`?
3. Rack nav vs real tabs (T1): do you want the secondary sections behind tabs?
4. Should the light theme stay available (it does now, via the ☾ button)?
5. Knob size: 72 px is a compromise for 8 knobs in one row at 1280 px. Bigger for the stage?
6. Should dirty blocks also show *which* parameter changed (e.g. a dot on the knob)?
7. Matribox units: can we map the common parameters (Time ms, Rate Hz, Level dB) in the catalog?
