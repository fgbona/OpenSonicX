# Changelog

All notable changes to this project are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CI smoke test: every push and pull request builds the container image,
  starts it and checks with `scripts/smoke-test.sh` that the editor page,
  its static assets and the non-root user are in place.
- Release pipeline split into verify, publish, smoke and release jobs. The
  published image is pulled back and smoke-tested before `latest` moves and
  the GitHub release is created.

### Changed

- Container images are published for `linux/amd64` and `linux/arm64`, so
  the image runs on Apple Silicon and ARM servers.

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

[Unreleased]: https://github.com/fgbona/pocket-master-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fgbona/pocket-master-editor/releases/tag/v0.1.0
