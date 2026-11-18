# Changelog

All notable changes to this project are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Save to a preset slot (phase 3). Save… opens a sheet with the target
  slot (P01..P50, with current names), the name (1..10 ASCII characters)
  and what will be overwritten. Before writing, the editor:
  - backs up all 50 user presets once per connection (about 30 seconds);
  - backs up the target slot before every save;
  - puts your unsaved edits back on the loaded preset after each backup;
  then saves, requires the pedal's acknowledge and checks the name and
  content of the slot. Backups are downloaded as JSON files and kept in
  the browser (last 3 full and 20 slot backups).
- Backups panel: download any backup, import a backup file, and restore a
  slot from a backup (what the slot holds is backed up first). Settings
  the editor does not decode yet, such as the probable tempo, are not
  restored; the file keeps the raw dump.
- `packages/core`: selectPreset, savePreset, setPresetVolume,
  isPresetOperation, decodePresetNames, decodeAck, the Pedal interface
  and the backupAllSlots, saveToSlot and restoreFromBackup flows, tested
  against a simulated pedal that applies real commands to real dumps.
- Web link: a third guarded send path for preset selections and
  user-slot saves that waits for the acknowledge and never re-sends a
  save.

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

[Unreleased]: https://github.com/fgbona/pocket-master-editor/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fgbona/pocket-master-editor/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/fgbona/pocket-master-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fgbona/pocket-master-editor/releases/tag/v0.1.0
