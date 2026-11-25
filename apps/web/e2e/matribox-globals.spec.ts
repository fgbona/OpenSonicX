import { MB_GLOBAL_TEMPO_ID, MB_GLOBALS, readFloat32LE } from '@pocket-master/core';
import type { Page } from '@playwright/test';
import { connectMatribox, expect, test } from './matribox-fixtures.ts';

/** Delivers a frame the simulated unit sends on its own (no request from the editor). */
const fromUnit = (page: Page, frame: Uint8Array) => page.evaluate((bytes) => window.__midi.receive('Matribox II PRO', bytes), Array.from(frame));

async function openGlobals(page: Page) {
  await connectMatribox(page);
  await page.getByRole('button', { name: 'Global options' }).click();
  return page.getByRole('dialog', { name: 'Global options' });
}

test('Global options shows what the unit holds and writes each change to it', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  const general = () => unit.globals.general;
  await expect(dialog.getByRole('radiogroup', { name: 'Input mode' }).getByRole('radio', { name: 'Electric' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('switch', { name: 'Global EQ on' })).toHaveAttribute('aria-checked', 'true');

  await dialog.getByRole('radiogroup', { name: 'Input mode' }).getByRole('radio', { name: 'Line' }).click();
  await expect.poll(() => general()[MB_GLOBALS.inputMode.at]).toBe(2);

  await dialog.getByRole('slider', { name: /^Input level/ }).fill('-6');
  await expect.poll(() => general()[MB_GLOBALS.inputLevel.at]).toBe(0xfa);
  await dialog.getByRole('slider', { name: /^AUX level/ }).fill('80');
  await expect.poll(() => general()[MB_GLOBALS.auxLevel.at]).toBe(80);

  await dialog.getByRole('radiogroup', { name: 'Footswitch mode' }).getByRole('radio', { name: 'Preset' }).click();
  await expect.poll(() => general()[MB_GLOBALS.currentMode.at]).toBe(0);

  // MIDI In Source: TRS only is shown but cannot be picked (the editor's Control Changes need USB).
  const source = dialog.getByRole('combobox', { name: /^MIDI In Source/ });
  await expect(source.locator('option', { hasText: 'TRS only' })).toBeDisabled();
  await source.selectOption({ label: 'USB only' });
  await expect.poll(() => general()[MB_GLOBALS.midiSource.at]).toBe(1);

  await dialog.getByRole('combobox', { name: /^Input channel/ }).selectOption({ label: '5' });
  await expect.poll(() => general()[MB_GLOBALS.midiChannelUsb.at]).toBe(5);

  await dialog.getByRole('switch', { name: 'Global EQ on' }).click();
  await expect.poll(() => unit.globals.eqOn).toBe(false);
  await dialog.getByRole('slider', { name: /^Level/ }).fill('70');
  await expect.poll(() => readFloat32LE(unit.globals.eq, 30 * 4)).toBe(70);
  // Only band 2's write was captured: the others show the unit's value and stay disabled.
  await expect(dialog.getByRole('slider', { name: /^Band 1 · 250 Hz/ })).toBeDisabled();
  await dialog.getByRole('slider', { name: /^Band 2 · 500 Hz/ }).fill('3');
  await expect.poll(() => readFloat32LE(unit.globals.eq, 14 * 4)).toBe(3);

  // The tuner and tempo controls now go on the unit's channel.
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('combobox', { name: 'MIDI channel' })).toHaveValue('5');
});

test('Global options follows the settings changed on the unit', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  const stomp = dialog.getByRole('radiogroup', { name: 'Footswitch mode' }).getByRole('radio', { name: 'Stomp' });
  await expect(stomp).toHaveAttribute('aria-checked', 'true');
  await fromUnit(page, unit.onUnitGlobal(MB_GLOBALS.currentMode.id, 0));
  await expect(dialog.getByRole('radiogroup', { name: 'Footswitch mode' }).getByRole('radio', { name: 'Preset' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByText('On, 100 BPM')).toHaveCount(0); // off, never set

  await fromUnit(page, unit.onUnitGlobal(MB_GLOBAL_TEMPO_ID, 100));
  await expect(dialog.getByText('On, 100 BPM')).toBeVisible();
});

test('a global write the unit does not confirm is an error, and the unit is read again', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  unit.echoes = false; // the unit takes the write but does not confirm it
  await dialog.getByRole('radiogroup', { name: 'Input mode' }).getByRole('radio', { name: 'Line' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not confirm the write', { timeout: 10_000 });
  // The read after the failure shows what the unit holds (it did take it here).
  await expect(dialog.getByRole('radiogroup', { name: 'Input mode' }).getByRole('radio', { name: 'Line' })).toHaveAttribute('aria-checked', 'true');
});
