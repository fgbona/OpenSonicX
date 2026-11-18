# Pocket Master editor: read-only first release

## Intent

A free, open browser editor for the Sonicake Pocket Master, in the spirit of
Preset Forge (which targets the Valeton GP-200). It will be hosted publicly so
anyone can use it from their own browser. This release is the start of a
product: the owner plans a logged-in user area and more features later. A later
MCP server reuses the same protocol core, so the core must not depend on any
browser API.

## Goals of this release (read-only)

1. List MIDI ports and connect to the Pocket Master.
2. Read the edit buffer and show the block chain with every parameter.
3. Log every SysEx message sent and received, in hex.

## Non-goals (later, only after hardware validation by the owner)

- Live parameter editing.
- Writing to a preset slot, always preceded by a backup.
- MCP server (`apps/mcp`).

## Anti-goals

- Writing anything to the pedal in this release. The send path refuses every
  payload that is not a GET query (`0x12`).
- Reusing Preset Forge code (GPL-3.0). Everything is written from scratch.

## Constraints

- Firmware V1.3.3, USB MIDI. Validated on hardware 2026-11-18: preset P08 dump,
  476 bytes in 26 packets, all CRCs valid, values confirmed on the unit.
- Web MIDI with SysEx works only in Chromium browsers (Chrome, Edge, Opera).
  Safari and Firefox are out of scope; the page says so.
- No backend features in this release, but the web app must be able to grow
  into one (accounts, saved presets, public pages) without a rewrite.

## Protocol source

`voronkovd/pocket-master-mcp`, `docs/PROTOCOL.md` (MIT). The model and
parameter catalog comes from that repo's `device_map.json`, which in turn was
derived from PocketEdit (no declared license). The catalog lives in one data
file with attribution so it can be replaced if its provenance becomes a problem
for public release.

## Approaches considered

1. **Next.js (App Router) + React + TypeScript** (chosen). Room for login,
   API routes, a preset database and public shareable pages in the same app.
   Web MIDI lives in client components. Hosts on Vercel or any Node host.
2. Vite + React single-page app, with a separate backend later (for example a
   managed auth and database service). Lighter today, but public pages have no
   server rendering and the backend becomes a second deployable.
3. Vite without a UI framework. Smallest now, but a rewrite once the product
   grows past one screen. Chosen first, then dropped when the owner said the
   product will have a logged-in area.

The owner delegated the choice. Approach 1 fits the product direction while
keeping this release small: no auth, no database, no API routes yet.

## Design

- npm workspaces: `packages/core`, `apps/web` (Next.js).
- `packages/core` (pure TypeScript, erasable syntax so Node runs it directly):
  - framing: CRC-8/SMBus, nibble expand/collapse, build and parse frames
  - multi-packet reassembly
  - query builders and an `isReadOnly` guard
  - edit-buffer dump decoder into a typed preset (chain, on/off, model,
    parameters with display values)
  - catalog JSON and lookups
  - hex formatting
  - tests with `node:test`, fixtures: reference P34 dump and the owner's real
    P08 capture (raw SysEx messages)
- `apps/web`: one client-rendered editor route. Port selection (auto-picks a port named "Pocket Master"), connect,
  read current preset number and edit buffer, render the chain, TX/RX hex log
  with timestamps. Queries retry when a multi-packet reply is incomplete
  (the reference notes USB occasionally drops packets).

## Left to the builder

File layout inside each package, styling, log size limit.
