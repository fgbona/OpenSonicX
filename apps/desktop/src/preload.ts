/**
 * The only bridge between the editor page and the app: the AI connection's switch and panel
 * state, and the tool calls the local MCP server hands to the editor. Nothing else of Electron or
 * Node reaches the page. The token never comes here: copying it happens in the main process.
 */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';

type Result = { ok: boolean; text: string };

const listen = <T>(channel: string, f: (event: IpcRendererEvent, value: T) => void) => {
  ipcRenderer.on(channel, f);
  return () => {
    ipcRenderer.removeListener(channel, f);
  };
};

contextBridge.exposeInMainWorld('opensonicx', {
  ai: {
    state: () => ipcRenderer.invoke('ai:state'),
    setEnabled: (on: boolean) => ipcRenderer.invoke('ai:enable', on === true),
    regenerate: () => ipcRenderer.invoke('ai:regenerate'),
    copy: (what: 'token' | 'command' | 'url') => ipcRenderer.invoke('ai:copy', what),
    onState: (f: (state: unknown) => void) => listen('ai:state', (_e, state: unknown) => f(state)),
    /** The editor serves these tools; each call runs `run` and its answer goes back to the client. */
    serve: (tools: unknown, run: (name: string, args: unknown) => Promise<Result>) => {
      ipcRenderer.send('ai:tools', tools);
      const off = listen('ai:call', (_e, call: { id: string; name: string; args: unknown }) => {
        void Promise.resolve()
          .then(() => run(call.name, call.args))
          .catch((error: unknown) => ({ ok: false, text: `Error: ${error instanceof Error ? error.message : String(error)}` }))
          .then((r) => ipcRenderer.send('ai:result', { id: call.id, ok: r.ok === true, text: String(r.text) }));
      });
      return () => {
        off();
        ipcRenderer.send('ai:tools', null);
      };
    },
  },
});
