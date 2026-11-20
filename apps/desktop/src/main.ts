/**
 * Desktop shell of the editor: serves the web app's static export over a privileged app://
 * scheme (a secure context, so Web MIDI, Web Bluetooth, workers and Cache Storage work), grants
 * MIDI to that origin only, picks the pedal for Web Bluetooth, and keeps itself up to date from
 * GitHub Releases: electron-updater on Windows and Linux, our own swap on macOS (mac-update.ts),
 * where it only announces the update when the app cannot replace itself.
 */
import { app, BrowserWindow, dialog, net, protocol, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appBundle, canReplace, pickZip, prepare, startSwap } from './mac-update.ts';
import { resolveAppFile } from './serve.ts';

const ORIGIN = 'app://editor';
const RELEASES = 'https://github.com/fgbona/sonicake-pocket-master-editor/releases';
const BLUETOOTH_TIMEOUT_MS = 15_000;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const pt = () => app.getLocale().toLowerCase().startsWith('pt');
const text = {
  available: (v: string) => (pt() ? `A versão ${v} do Pocket Master Editor está disponível.` : `Pocket Master Editor ${v} is available.`),
  download: () => (pt() ? 'Abrir página de download' : 'Open download page'),
  ready: (v: string) => (pt() ? `A versão ${v} foi baixada e será instalada ao reiniciar.` : `Version ${v} was downloaded and installs on restart.`),
  restart: () => (pt() ? 'Reiniciar agora' : 'Restart now'),
  later: () => (pt() ? 'Depois' : 'Later'),
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 600,
    title: 'Pocket Master Editor',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links (tone3000.com, release pages) open in the browser; the window stays on the editor.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(ORIGIN)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // Chrome shows its own Bluetooth chooser; Electron leaves it to the app: take the first pedal.
  let pick: { done: (id: string) => void; timer: NodeJS.Timeout } | null = null;
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (!pick) {
      const timer = setTimeout(() => { pick?.done(''); }, BLUETOOTH_TIMEOUT_MS);
      pick = { timer, done: (id) => { clearTimeout(timer); pick = null; callback(id); } };
    }
    const pedal = devices.find((d) => /pocket/i.test(d.deviceName));
    if (pedal) pick.done(pedal.deviceId);
  });
  void win.loadURL(`${ORIGIN}/`);
}

/** Offers to restart now; otherwise `install` runs when the app quits. */
async function offerRestart(version: string, install: (relaunch: boolean) => void): Promise<void> {
  const { response } = await dialog.showMessageBox({ type: 'info', message: text.ready(version), buttons: [text.restart(), text.later()] });
  if (response === 0) install(true);
  else app.once('will-quit', () => install(false));
}

/** macOS: download, verify and swap the bundle ourselves; announce the release when that is not possible. */
async function updateMac(version: string, files: readonly { url: string; sha512: string }[]): Promise<void> {
  const bundle = appBundle(process.execPath);
  const zip = pickZip(files, process.arch);
  if (zip && canReplace(bundle)) {
    try {
      const next = await prepare(zip, `${RELEASES}/download/v${version}/${zip.url}`, net.fetch);
      return offerRestart(version, (relaunch) => {
        startSwap(bundle, next, process.pid, relaunch);
        if (relaunch) app.quit();
      });
    } catch (error) {
      console.warn('self-update failed, announcing the release instead:', (error as Error).message);
    }
  }
  const { response } = await dialog.showMessageBox({ type: 'info', message: text.available(version), buttons: [text.download(), text.later()] });
  if (response === 0) void shell.openExternal(`${RELEASES}/tag/v${version}`);
}

function checkForUpdates(): void {
  const { autoUpdater } = electronUpdater;
  const mac = process.platform === 'darwin';
  autoUpdater.autoDownload = !mac;
  autoUpdater.on('update-available', (info) => {
    if (mac) void updateMac(info.version, info.files);
  });
  autoUpdater.on('update-downloaded', (info) => {
    // Later: electron-updater installs it when the app quits (autoInstallOnAppQuit).
    void offerRestart(info.version, (relaunch) => { if (relaunch) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', (error) => console.warn('update check failed:', error.message)); // offline is normal
  void autoUpdater.checkForUpdates().catch((error: Error) => console.warn('update check failed:', error.message));
}

void app.whenReady().then(() => {
  const root = join(app.getAppPath(), 'web');
  protocol.handle('app', (request) => net.fetch(pathToFileURL(resolveAppFile(root, request.url)).toString()));
  const midiOnly = (origin: string, permission: string) => origin.startsWith(ORIGIN) && (permission === 'midi' || permission === 'midiSysex');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => done(midiOnly(details.requestingUrl, permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => midiOnly(origin, permission));
  createWindow();
  if (app.isPackaged) checkForUpdates();
});

app.on('window-all-closed', () => app.quit());
