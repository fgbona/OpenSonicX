/**
 * A page whose Web MIDI is a fake "Matribox II PRO" port wired to the core suite's simulated unit
 * (packages/core/test/fake-matribox.ts) in this process; never a real device. The model catalog
 * offered to the editor is an invented one (the real alg_data.json is Sonicake's).
 */
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_ALG_DATA } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { wireMidi } from './fixtures.ts';

/** The frames the simulated unit answers one frame from the editor with. */
export async function answer(unit: FakeMatribox, bytes: Uint8Array): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  unit.listen((frame) => void out.push(frame));
  unit.send(bytes);
  await new Promise((resolve) => setImmediate(resolve)); // the fake answers on the next turn, as the USB link does
  return out;
}

/** A simulated unit that answers quietly (the link skips notifications; keep the e2e traffic small). */
export function quietMatribox(): FakeMatribox {
  const unit = new FakeMatribox();
  unit.noise = [];
  return unit;
}

export const test = base.extend<{ unit: FakeMatribox }>({
  unit: [
    async ({ page }, use) => {
      const unit = quietMatribox();
      await wireMidi(page, { 'Matribox II PRO': (bytes) => answer(unit, bytes) }, { plugged: ['Matribox II PRO'], denials: 0 });
      await use(unit);
    },
    { auto: true },
  ], // always: a page here must never reach the real Web MIDI
});
export { expect };

export const CATALOG_FILE = { name: 'alg_data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(FAKE_ALG_DATA)) };

/** The heading of the preset the simulated Matribox has loaded. */
export const loadedMatribox = (page: Page) => page.getByRole('heading', { name: '17C Drive AD' });

/** Opens the editor, which finds the plugged-in Matribox by itself; returns once its loaded preset shows. */
export async function connectMatribox(page: Page) {
  await page.goto('/');
  await expect(loadedMatribox(page)).toBeVisible();
}

/** The chain as its tiles name it, "DYN → DRV → …", once it shows exactly that. */
export async function expectChain(page: Page, modules: string) {
  await expect.poll(async () => (await page.locator('.tiles .tile-label').allTextContents()).filter((m) => m !== 'Add').join(' → ')).toBe(modules);
}

/** The panel of the block at `position`, selected from its tile first. */
export async function blockPanel(page: Page, position: number, module: string) {
  await page.getByRole('button', { name: new RegExp(`^Edit ${position}\\. ${module}:`) }).click();
  return page.getByRole('region', { name: `${position}. ${module} block` });
}

/** Turns a knob (role slider) to `value` from the keyboard: Home, then tenths of its range, then single steps. */
export async function turnKnob(knob: Locator, value: number) {
  const min = Number(await knob.getAttribute('aria-valuemin'));
  const max = Number(await knob.getAttribute('aria-valuemax'));
  const tenth = (max - min) / 10;
  // Each key waits for the knob to show its step: the knob reads its value from the last render.
  let now = min;
  const press = async (key: string, step: number) => {
    now += step;
    await knob.press(key);
    await expect(knob).toHaveAttribute('aria-valuenow', String(now));
  };
  await knob.focus();
  await press('Home', 0);
  for (let i = 0; i < Math.floor((value - min) / tenth); i++) await press('PageUp', tenth);
  for (let i = 0; i < Math.round((value - min) % tenth); i++) await press('ArrowUp', 1);
}

export async function pickCatalog(page: Page) {
  await page.getByLabel('Choose alg_data.json').setInputFiles(CATALOG_FILE);
  await expect(page.getByText('Model catalog: 10 models.')).toBeVisible();
}
