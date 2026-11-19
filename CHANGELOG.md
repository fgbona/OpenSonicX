# Changelog

All notable changes to this project are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.9.0] - 2026-11-19

The MCP server builds tones from a reference. Validated by the owner on a
V1.3.3 unit through Claude Code: "Black Album" saved to P50 and an Iron
Maiden "Stranger in a Strange Land" tone saved to P49, then refined and
saved again, each save backing up the slot it replaced. Container image:
`ghcr.io/fgbona/pocket-master-editor:v0.9.0` (amd64 and arm64; the image
serves the web editor).

### Added

- The MCP server knows what every model is: `list_models` (now also
  without a block, for the whole pedal) gives the real gear each model is
  based on, from the Pocket Master manual, a short description and its
  parameters with ranges. Models can also be named by that gear ("Dual
  Rectifier Modern", "JCM800", "Tube Screamer"). Models added after the
  manual's firmware say so instead of guessing.
- The server tells the assistant how to build a tone from a reference (an
  artist or record): work out the gear, map it to the pedal's models and
  build the whole chain in one edit, without asking for details.

## [0.8.0] - 2026-11-19

MCP server (preview): an AI assistant can read and edit the pedal's presets
in conversation. Container image: `ghcr.io/fgbona/pocket-master-editor:v0.8.0`
(amd64 and arm64; the image serves the web editor).

### Added

- MCP server (`apps/mcp`, preview): an AI assistant can read the loaded
  preset, list presets and models, edit by name (parameters, block on/off,
  models including user IRs and captured profiles, chain order, volume),
  load and revert presets, export and import preset files, and save to a
  user slot with a confirmation and a backup file, which `restore_backup`
  undoes. Reading, live edits and revert verified on a V1.3.3 unit over
  USB; save, restore and preset files are tested against the simulated
  pedal.
- Core resolves blocks, parameters, models and preset labels by name, never
  guessing: unknown or ambiguous names fail with the valid choices.

### Changed

- The guarded link to the pedal, the pedal adapter and the model labels
  moved from the web app to core, behind a two-function MIDI port, so the
  web editor and the MCP server run the same tested code.

### Fixed

- Save and restore now wait for the backup to be stored before the slot is
  overwritten, and stop when it cannot be stored. Before, the web editor
  started the save while the backup was still being kept.

## [0.7.0] - 2026-11-18

Captured profiles (clone mode) on AMP, validated on a Pocket Master with
firmware V1.3.3 and a NAM capture. Container image:
`ghcr.io/fgbona/pocket-master-editor:v0.7.0` (amd64 and arm64).

### Added

- Captured profiles (clone mode) on AMP. The AMP model list groups amp
  models and the occupied captured-profile slots by name (for example
  "Randall SA (profile 1)"); choosing a profile switches amp mode on,
  choosing an amp switches it off. Like the unit's own controls, choosing a
  profile turns IR off and leaving clone mode turns IR back on (the unit
  does this only for changes made on it, not over MIDI, so the editor sends
  it); switching between amp models leaves IR alone. In clone mode the chain and the AMP card show
  the profile name. Clone decoding is now verified on hardware with the
  owner's NAM capture.

### Changed

- Revert reloads the preset from its slot, like switching presets on the
  unit, so the edit buffer goes back to exactly what is saved, even if it
  was edited before the editor connected. The editor also reads and follows
  the pedal's own "modified" flag (12 45), so Revert is available whenever
  the pedal says the edit buffer differs from the slot.

### Fixed

- The toolbar's frosted-glass blur never applied in Chrome: the CSS
  optimiser kept only `-webkit-backdrop-filter` of the pair. The prefixed
  declaration now comes first, so the standard one survives and text
  scrolling under the toolbar is blurred instead of showing through.

## [0.6.0] - 2026-11-18

User IR slots show the names of the loaded IR files, validated on a Pocket
Master with firmware V1.3.3. Container image:
`ghcr.io/fgbona/pocket-master-editor:v0.6.0` (amd64 and arm64).

### Added

- User IR slots show the names of the IR files loaded on the pedal (for
  example "Marshal 80 (User IR 1)") in the chain, the IR card and its
  model list; an empty slot keeps its generic name. Read once on connect
  (query 12 20); `decodeSlotNames` also reads captured-profile slots
  (12 24), tested on the owner's real replies.

## [0.5.0] - 2026-11-18

Export and import presets as files, validated on a Pocket Master with
firmware V1.3.3. Container image: `ghcr.io/fgbona/pocket-master-editor:v0.5.0`
(amd64 and arm64).

### Added

- Export and import presets. Export re-reads the edit buffer from the pedal
  and downloads it as a `pocket-master-preset` JSON file with the raw dump,
  so settings the editor does not decode yet are kept. Import asks first,
  loads the file into the edit buffer with live-edit commands and checks it
  on the pedal; nothing is saved to a slot, and Revert brings back the
  preset you had. Foreign, damaged or unknown-model files are refused.

## [0.4.0] - 2026-11-18

Portuguese interface, the screen follows the pedal, a theme button and a
half-size container image. Validated on a Pocket Master with firmware V1.3.3.
Container image: `ghcr.io/fgbona/pocket-master-editor:v0.4.0` (amd64 and arm64).

### Added

- The screen follows the pedal: knobs turned and blocks switched on the
  unit show up at once; a model or amp-mode change on the unit is re-read.
- Light/dark theme button in the toolbar. Without a choice the page
  follows the system; the choice is remembered in this browser and applied
  before the page paints.
- Portuguese (Brazil) interface. The language follows the browser (any pt
  locale gets Portuguese, everything else English), a PT/EN switch in the
  toolbar changes it, and the choice is remembered in this browser. The
  editor's own error and progress messages are translated; protocol
  details from the core (SysEx log labels, decoder errors) stay in
  English.
- App icon (favicon).

### Changed

- Container runtime is Alpine 3.23 with only Alpine's nodejs package (Node
  24, no npm, no yarn, apk removed), replacing distroless; sharp is dropped
  since image optimisation is off. Image layers go from 189 MB to about
  95 MB.
- Save… stays disabled until a preset was read from the pedal.
- The SysEx log and the chain view are memoised, so each incoming packet
  renders one log line instead of the whole page (selections during a
  backup were taking up to a second).

### Fixed

- The pedal acknowledges every edit too (14 08 00, seen on hardware); the
  link consumes those acknowledges and a selection or save waits for them,
  so a late edit acknowledge can never answer a preset operation.
- A packet whose index is outside its set no longer crashes reassembly.
- Short dump records are reported in words ("record 0x3003 is too short");
  the optional volume record may still be absent.
- A MIDI port that fails to send (cable pulled) rejects with a readable
  error and leaves no timer or listener behind, on all three send paths.

## [0.3.0] - 2026-11-18

Save to a preset slot, validated on a Pocket Master with firmware V1.3.3:
save with and without the target backup, and restore from a backup.
Container image: `ghcr.io/fgbona/pocket-master-editor:v0.3.0` (amd64 and arm64).

### Added

- Save to a preset slot (phase 3). Save… opens a sheet with the target
  slot (P01..P50, with current names), the name (1..10 ASCII characters)
  and what will be overwritten. Before writing, the editor backs up the
  target slot (about 1 second) and puts your unsaved edits back on the
  loaded preset; then it saves, requires the pedal's acknowledge and
  checks the name and content of the slot. A "Don't back up before
  saving" checkbox skips the backup for one save; it is off every time
  the sheet opens. Backups are kept in the browser (last 20) and offered
  as JSON downloads when the save ends, also when it fails. A warning
  appears if the browser cannot keep them.
- A save is refused when the pedal's preset no longer matches the screen
  (knob turned on the unit) or uses a model the editor does not know.
- Backups panel: download any backup, import a backup file, and restore a
  slot from a backup (what the slot holds is backed up first). Settings
  the editor does not decode yet, such as the probable tempo, are not
  restored; the file keeps the raw dump. A restore always backs up the
  slot it overwrites.
- `packages/core`: selectPreset, savePreset, setPresetVolume,
  isPresetOperation, decodePresetNames, decodeAck, the Pedal interface
  and the saveToSlot and restoreFromBackup flows (plus backupAllSlots,
  not used by the editor yet), tested
  against a simulated pedal that applies real commands to real dumps.
- Web link: a third guarded send path for preset selections and
  user-slot saves. Every operation waits for its own acknowledge (the
  pedal acknowledges selections too, seen on hardware), so a late
  selection acknowledge can never be taken for the save's; nothing is
  re-sent.

### Changed

- Preset volume is a live edit and part of Revert.

## [0.2.0] - 2026-11-18

Live edit, validated on a Pocket Master with firmware V1.3.3: parameters,
block on/off, model changes, chain order, Revert (including knob turns made
on the unit) and preset changes from the footswitch.
Container image: `ghcr.io/fgbona/pocket-master-editor:v0.2.0` (amd64 and arm64).

### Added

- Live edit (phase 2). A Live edit switch, off by default, turns the
  editor into a live controller of the pedal's edit buffer:
  - parameter sliders, switches and option lists, and block on/off;
  - model selection per block (AMP lists amp models; captured profiles
    are shown but not selectable);
  - chain reordering by drag and drop or arrow buttons, with
    DRV-AMP-IR-EQ moving as one group.
  Nothing is saved to a preset slot.
- Restore point and Revert: the first read of a preset is kept. Revert
  re-reads the pedal, so knob turns made on the unit are undone too, then
  sends only the edits needed to return to it (chain, then models, then
  on/off, then parameters).
- A preset switched on the pedal during live edit is detected from its
  notification and re-read, so edits never land on a preset the screen
  does not show.
- `packages/core`: command builders for chain, model, parameter, block
  on/off and amp mode, checked byte for byte against ~7400 captured
  commands; `isAllowedEdit` guard; `encodeValue`; `applyEdit`,
  `editToCommands`, `diffPresets`; `chainUnits` and `moveInChain`.
- Web link edit path: only live-edit commands pass, messages are spaced
  20 ms apart and a slider drag sends only its latest value.

### Changed

- GitHub Actions bumped: upload-artifact v7, download-artifact v8,
  login-action v4, build-push-action v7, setup-qemu-action v4 (the
  Dependabot updates, applied together and exercised by this release).
- After a model or chain change the editor re-reads the edit buffer, so
  the screen shows the defaults the pedal applied. A dump requested before
  the latest edit is discarded and read again, so sliders never jump back.
- A model code the catalog does not know is still applied and shown as
  hex instead of crashing the page.

## [0.1.1] - 2026-11-18

Hardened container and a release pipeline that tests what it publishes.
Container image: `ghcr.io/fgbona/pocket-master-editor:v0.1.1` (amd64 and arm64).

### Added

- CI smoke test: every push and pull request builds the container image,
  starts it and checks with `scripts/smoke-test.sh` that the editor page,
  its static assets and the non-root user are in place.
- Release pipeline split into verify, publish, smoke and release jobs. The
  published image is pulled back and smoke-tested before `latest` moves and
  the GitHub release is created.

- CI lints the Dockerfile with hadolint, validates compose.yaml and scans
  the image with Trivy (fails on HIGH or CRITICAL issues that have a fix).
  The release pipeline scans the published image too.
- Dependabot for base-image digests, GitHub Actions and npm packages.

### Changed

- Container images are published for `linux/amd64` and `linux/arm64`, so
  the image runs on Apple Silicon and ARM servers.
- Hardened container image: base images pinned by digest, distroless
  Node 24 runtime (no shell, no package manager), root-owned read-only app
  files, unprivileged user 65532, Node-based health check, dependency
  install with `--ignore-scripts`, narrower build context.
- Hardened compose.yaml: read-only root filesystem with a small `/tmp`
  tmpfs, all capabilities dropped, `no-new-privileges`, init process,
  port bound to localhost, pid, memory and CPU limits, rotated logs.
- The smoke test runs the image with the same restrictions as compose.yaml
  and also checks the health check and a clean stop on SIGTERM.

## [0.1.0] - 2026-11-18

Read-only preview, validated on a Pocket Master with firmware V1.3.3.
Container image: `ghcr.io/fgbona/pocket-master-editor:v0.1.0`.

### Added

- `packages/core`: Pocket Master SysEx protocol in TypeScript with no browser
  or MIDI dependency.
  - Framing: CRC-8/SMBus, nibble expansion, frame build and parse.
  - Multi-packet reassembly that never returns a partial reply.
  - Read-only guard (`isReadOnly`) that accepts only GET (`0x12`) queries.
  - Edit-buffer decoder: chain order, block on/off, model, parameters with
    kind, range and display text. Unknown effect codes render as hex.
  - Model catalog (9 blocks, 110 models), preset labels (P01..P50, F01..F50),
    and log labels for every SysEx message.
  - Tests on `node:test` against real captures: preset P08 from a V1.3.3 unit
    and the reference P34 dump.
- `apps/web`: read-only Next.js editor.
  - Lists MIDI ports and auto-selects the Pocket Master. Never preselects
    another device.
  - Reads the current preset and edit buffer and shows the signal chain and
    every parameter.
  - Logs every SysEx message sent and received, in hex, with time and label.
    Copy and Clear buttons.
  - Apple system fonts and system colors, light and dark mode.
  - Enables MIDI on load when the visitor already granted access.
  - Link tests: retry after a timeout, readable error after three tries,
    cancel on close, notifications not mistaken for replies.
- Container image: Next.js standalone server, multi-stage build that runs the
  tests, non-root user, health check. `compose.yaml` for local use.
- MIT license, NOTICE with third-party attribution, README, CONTRIBUTING, CI.
- Release workflow: a `v*.*.*` tag publishes the container image to GHCR and a
  GitHub release with this changelog's notes.

### Fixed

- Disconnecting during a read no longer sends more queries or flips the
  status back to Connected.
- Double-clicking Connect no longer opens two links on the same ports.
- An out-of-range preset index from the pedal shows an error instead of
  crashing the page.

[Unreleased]: https://github.com/fgbona/pocket-master-editor/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/fgbona/pocket-master-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fgbona/pocket-master-editor/releases/tag/v0.1.0
