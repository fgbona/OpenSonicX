import type { Page } from '@playwright/test';
import { test, expect, loadedPreset, wireMidi } from './fixtures.ts';
import { answer, loadedMatribox, quietMatribox } from './matribox-fixtures.ts';
import { SysexPedal } from './sysex-pedal.ts';

const plug = (page: Page, name: string) => page.evaluate((n) => window.__midi.plug(n), name);
const unplug = (page: Page, name: string) => page.evaluate((n) => window.__midi.unplug(n), name);
const chip = (page: Page) => page.getByRole('status').filter({ has: page.locator('.status-dot') });
const waiting = (page: Page) => page.getByRole('heading', { name: 'Plug in your pedal' });

test('the plugged-in pedal is found and read on load, with no ports or connect buttons', async ({ page, pedal }) => {
  await page.goto('/');
  await expect(loadedPreset(page, pedal)).toBeVisible();
  await expect(chip(page)).toHaveText('Pocket Master · USB');
  await expect(page.locator('.brand')).toHaveText(/OpenSonicX\s*·\s*Pocket Master/);
  await expect(page).toHaveTitle('OpenSonicX · Pocket Master');
  for (const name of ['Connect', 'Disconnect', 'Allow MIDI access']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Input' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Output' })).toHaveCount(0);
});

test.describe('with no pedal plugged in', () => {
  test.use({ plugged: [] });

  test('waits calmly, then follows the pedal being plugged in, out, and in again', async ({ page, pedal }) => {
    await page.goto('/');
    await expect(waiting(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Waiting for a pedal');
    await expect(page.locator('.brand')).toHaveText(/OpenSonicX$/);

    await plug(page, 'Pocket Master');
    await expect(loadedPreset(page, pedal)).toBeVisible();

    await unplug(page, 'Pocket Master');
    await expect(waiting(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Waiting for a pedal');
    await expect(page.locator('main > p.alert')).toHaveCount(0);

    // A power cycle: new port objects; the old ones are dead.
    await plug(page, 'Pocket Master');
    await expect(loadedPreset(page, pedal)).toBeVisible();
    await expect(chip(page)).toHaveText('Pocket Master · USB');
  });

  test('the Bluetooth button still connects the Pocket Master', async ({ page, pedal }) => {
    await page.goto('/');
    await expect(waiting(page)).toBeVisible();
    await page.getByRole('button', { name: 'Connect via Bluetooth' }).click();
    await expect(loadedPreset(page, pedal)).toBeVisible();
    await expect(chip(page)).toHaveText('Pocket Master · Bluetooth');
  });
});

test.describe('when MIDI access is refused', () => {
  test.use({ denials: 1 });

  test('says so and offers one button to ask again', async ({ page, pedal }) => {
    await page.goto('/');
    await expect(page.locator('main > p.alert')).toHaveText(/MIDI access was blocked/);
    await page.getByRole('button', { name: 'Allow MIDI access' }).click();
    await expect(loadedPreset(page, pedal)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow MIDI access' })).toHaveCount(0);
  });
});

test.describe('with both pedals', () => {
  test.use({ plugged: [] });

  test('the Pocket Master comes first; a live connection is kept until its pedal goes', async ({ browser }) => {
    const page = await browser.newPage();
    const pedal = new SysexPedal();
    const unit = quietMatribox();
    await wireMidi(page, { 'Pocket Master': (b) => pedal.receive(b), 'Matribox II PRO': (b) => answer(unit, b) }, { plugged: ['Matribox II PRO', 'Pocket Master'], denials: 0 });
    await page.goto('/');
    await expect(loadedPreset(page, pedal)).toBeVisible();

    await unplug(page, 'Pocket Master');
    await expect(loadedMatribox(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Matribox II Pro · USB');
    await expect(page.locator('.brand')).toHaveText(/OpenSonicX\s*·\s*Matribox II Pro/);

    // Plugging the Pocket Master back does not pull the Matribox's editor away.
    await plug(page, 'Pocket Master');
    await page.waitForTimeout(300);
    await expect(loadedMatribox(page)).toBeVisible();

    await unplug(page, 'Matribox II PRO');
    await expect(loadedPreset(page, pedal)).toBeVisible();
    await page.close();
  });
});
