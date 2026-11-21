/**
 * A page whose Web MIDI is a fake "Pocket Master" port wired to a SysexPedal in this process,
 * so the editor runs its real connect, read, edit and save flows without hardware.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { SysexPedal } from './sysex-pedal.ts';

declare global {
  interface Window {
    __pedalSend(bytes: number[]): Promise<number[][]>;
  }
}

/** Runs in the page before any of its scripts: replaces navigator.requestMIDIAccess. */
function installFakeMidi() {
  const listeners: { onmidimessage: ((e: { data: Uint8Array }) => void) | null } = { onmidimessage: null };
  const common = { manufacturer: 'Sonicake', state: 'connected', connection: 'open', open: async () => undefined, close: async () => undefined };
  const input = { ...common, id: 'in-1', name: 'Pocket Master', type: 'input', set onmidimessage(f: typeof listeners.onmidimessage) { listeners.onmidimessage = f; }, get onmidimessage() { return listeners.onmidimessage; } };
  const output = {
    ...common, id: 'out-1', name: 'Pocket Master', type: 'output',
    send(bytes: ArrayLike<number>) {
      void window.__pedalSend(Array.from(bytes)).then((replies) => {
        // One packet after the other, a few ms apart, like the USB link.
        replies.forEach((r, i) => setTimeout(() => listeners.onmidimessage?.({ data: Uint8Array.from(r) }), 5 + 5 * i));
      });
    },
  };
  const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), sysexEnabled: true, onstatechange: null };
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
}

export const test = base.extend<{ pedal: SysexPedal }>({
  pedal: async ({ page }, use) => {
    const pedal = new SysexPedal();
    await page.exposeFunction('__pedalSend', async (bytes: number[]) => (await pedal.receive(Uint8Array.from(bytes))).map((f) => Array.from(f)));
    await page.addInitScript(installFakeMidi);
    await use(pedal);
  },
});
export { expect };

/** Opens the editor, enables MIDI and connects to the fake pedal; returns once P09 is read. */
export async function connect(page: Page, pedal: SysexPedal) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable MIDI' }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`P09\\s*${pedal.pedal.names[8]}`) })).toBeVisible();
}
