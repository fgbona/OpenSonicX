/**
 * The AI connection inside the app: the switch and token (ai-settings.ts), the local server
 * (ai-server.ts), the approval dialog, and the bridge that runs each tool call in the editor window
 * (preload.ts). The window never sees the token: copying it is done here.
 */
import { randomUUID } from 'node:crypto';
import { type BrowserWindow, clipboard, dialog, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron';
import type { AiTool, Approval } from './ai-approval.ts';
import { approvalText } from './ai-approval.ts';
import { DEFAULT_PORT, LOOPBACK, MCP_PATH, maskToken } from './ai-guard.ts';
import { type AiServer, type AiSession, startAiServer } from './ai-server.ts';
import { type AiSettings, disable, enable, loadAiSettings, regenerate, saveAiSettings } from './ai-settings.ts';

/** What the panel shows; the token only masked. */
export interface AiState {
  readonly enabled: boolean;
  readonly port: number | null;
  readonly defaultPort: number;
  readonly maskedToken: string | null;
  readonly lastRequestAt: number | null;
  readonly error: string | null;
}

/** A tool call may wait for the person (the Save dialog); past this the client gets an error. */
const CALL_TIMEOUT_MS = 10 * 60_000;

export const setupCommand = (port: number, token: string) => `claude mcp add --transport http opensonicx http://${LOOPBACK}:${port}${MCP_PATH} --header "Authorization: Bearer ${token}"`;

export function setupAiConnection(options: { userData: string; window: () => BrowserWindow | null; origin: string; pt: () => boolean }): { reset(): void } {
  let settings: AiSettings = loadAiSettings(options.userData);
  let server: AiServer | null = null;
  let lastRequestAt: number | null = null;
  let error: string | null = null;
  let tools: readonly AiTool[] | null = null;
  const pending = new Map<string, { resolve: (r: { ok: boolean; text: string }) => void; timer: NodeJS.Timeout }>();

  const state = (): AiState => ({
    enabled: settings.enabled,
    port: server?.port ?? null,
    defaultPort: DEFAULT_PORT,
    maskedToken: settings.token ? maskToken(settings.token) : null,
    lastRequestAt,
    error,
  });
  const publish = () => options.window()?.webContents.send('ai:state', state());
  const store = (next: AiSettings) => {
    settings = next;
    saveAiSettings(options.userData, next);
  };

  const session: AiSession = {
    tools: async () => tools ?? [],
    call: (name, args) => {
      const win = options.window();
      if (!win || tools === null) return Promise.resolve({ ok: false, text: 'Error: the OpenSonicX editor window is not open or not ready yet.' });
      const id = randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, text: 'Error: the editor did not answer in time.' });
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, timer });
        win.webContents.send('ai:call', { id, name, args });
      });
    },
  };

  const approve = async (approval: Approval) => {
    const text = approvalText(approval, options.pt());
    const box = { type: 'warning' as const, message: text.message, detail: text.detail, buttons: [text.deny, text.allow], defaultId: 0, cancelId: 0, noLink: true };
    const win = options.window();
    const { response } = await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
    return response === 1;
  };

  const start = async () => {
    if (server || !settings.enabled) return;
    try {
      server = await startAiServer({
        session,
        token: () => settings.token ?? '',
        approve,
        pt: options.pt,
        onRequest: () => {
          lastRequestAt = Date.now();
          publish();
        },
      });
      error = null;
    } catch (e) {
      error = (e as Error).message;
      console.warn('AI connection: could not start:', error);
    }
    publish();
  };
  const stop = async () => {
    const running = server;
    server = null;
    await running?.close();
    publish();
  };

  // Only the editor's own page may drive the switch or answer tool calls.
  const fromEditor = (event: IpcMainEvent | IpcMainInvokeEvent) => event.senderFrame?.url.startsWith(`${options.origin}/`) === true;

  ipcMain.handle('ai:state', (event) => (fromEditor(event) ? state() : null));
  ipcMain.handle('ai:enable', async (event, on: unknown) => {
    if (!fromEditor(event)) return null;
    if (on === true) {
      store(enable(settings));
      await start();
    } else {
      store(disable(settings));
      await stop();
    }
    return state();
  });
  ipcMain.handle('ai:regenerate', (event) => {
    if (!fromEditor(event) || !settings.token) return null;
    store(regenerate(settings)); // the server reads the token per request: the old one stops working now
    publish();
    return state();
  });
  ipcMain.handle('ai:copy', (event, what: unknown) => {
    if (!fromEditor(event) || !settings.token) return false;
    const port = server?.port ?? DEFAULT_PORT;
    clipboard.writeText(what === 'command' ? setupCommand(port, settings.token) : what === 'url' ? `http://${LOOPBACK}:${port}${MCP_PATH}` : settings.token);
    return true;
  });
  ipcMain.on('ai:tools', (event, list: unknown) => {
    if (!fromEditor(event)) return;
    tools = Array.isArray(list) ? (list as AiTool[]) : null;
  });
  ipcMain.on('ai:result', (event, result: unknown) => {
    if (!fromEditor(event) || typeof result !== 'object' || result === null) return;
    const { id, ok, text } = result as Record<string, unknown>;
    const call = typeof id === 'string' ? pending.get(id) : undefined;
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(id as string);
    call.resolve({ ok: ok === true, text: typeof text === 'string' ? text : 'Error: the editor answered without text.' });
  });

  void start();
  return {
    /** The page is loading again: its tool list and the calls it was running are gone. */
    reset: () => {
      tools = null;
      for (const [id, call] of pending) {
        clearTimeout(call.timer);
        pending.delete(id);
        call.resolve({ ok: false, text: 'Error: the editor window reloaded while running this tool; check the preset before trying again.' });
      }
    },
  };
}
