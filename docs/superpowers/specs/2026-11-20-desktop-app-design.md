# Desktop app (offline editor) — design

## Why

Some users want the editor without depending on a website: installed, usable offline, kept up
to date without re-downloading by hand. The owner asked for Linux, Windows (.exe) and macOS
(.dmg) builds with an updater.

## Decisions (agreed with the owner, 2026-11-20)

- **Electron.** The editor needs Web MIDI and Web Bluetooth, which only Chromium has. A
  system-WebView shell (Tauri) has no Web MIDI on macOS (WebKit).
- **No Apple Developer account.** The macOS build is not notarized: the first launch needs
  right-click > Open (or Privacy & Security > Open Anyway), and it cannot auto-update. On
  macOS the app only announces a new version and opens its release page. Windows (NSIS) and
  Linux (AppImage) update themselves in the background and apply on restart.
- **Updates come from GitHub Releases**, the same release the tag workflow already makes.

## How

- `apps/web` can be a static export (it has no server code): `next build` with
  `output: 'export'` when `NEXT_OUTPUT=export`; the container build keeps `standalone`.
- New workspace `apps/desktop`: an Electron main process (TypeScript, bundled by esbuild) that
  serves the export through a privileged `app://` scheme (standard, secure, fetch), so absolute
  paths (`/_next/...`, `/convert-worker.js`) resolve and the page is a secure context.
- Permissions: MIDI with SysEx allowed only for `app://`; Bluetooth: the
  `select-bluetooth-device` event picks the first device whose name contains "Pocket"
  (Chrome shows its own chooser; Electron does not), and gives up after 15 s.
- External links (tone3000.com, release pages) open in the default browser; the window never
  navigates away from `app://`.
- Offline: everything but TONE3000 and the first NAM conversion (the reference DI is
  downloaded once and kept in Cache Storage, as in the browser).
- Release workflow: a matrix job (ubuntu, windows, macos) builds after the GitHub release
  exists and uploads installers plus the updater metadata (`latest*.yml`) with `gh release
  upload`. The verify job also checks `apps/desktop` carries the tag's version.

## Not now

Code signing, a menu bar beyond the defaults, auto-start, tray icon, Linux .deb/.rpm.
