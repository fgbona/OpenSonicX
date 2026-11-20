/**
 * Desktop shell of the editor: serves the web app's static export over a privileged app://
 * scheme (a secure context, so Web MIDI, Web Bluetooth, workers and Cache Storage work), grants
 * MIDI to that origin only, picks the pedal for Web Bluetooth, and keeps itself up to date from
 * GitHub Releases. Unsigned macOS builds cannot install updates, so there it only announces them.
 */
import { app, BrowserWindow, dialog, net, protocol, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

function checkForUpdates(): void {
  const { autoUpdater } = electronUpdater;
  const installs = process.platform !== 'darwin';
  autoUpdater.autoDownload = installs;
  autoUpdater.on('update-available', async (info) => {
    if (installs) return; // downloads in the background; asked to restart once ready
    const { response } = await dialog.showMessageBox({ type: 'info', message: text.available(info.version), buttons: [text.download(), text.later()] });
    if (response === 0) void shell.openExternal(`${RELEASES}/tag/v${info.version}`);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({ type: 'info', message: text.ready(info.version), buttons: [text.restart(), text.later()] });
    if (response === 0) autoUpdater.quitAndInstall();
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
