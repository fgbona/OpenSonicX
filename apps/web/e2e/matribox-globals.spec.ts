import { MB_GLOBALS, readFloat32LE } from '@pocket-master/core';
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

  // Brightness is shown only (the unit takes no write of it).
  await expect(dialog.getByText('50 %')).toBeVisible();

  // 0 Stomp, 1 Preset: the simulated unit starts in Preset.
  await dialog.getByRole('radiogroup', { name: 'Footswitch mode' }).getByRole('radio', { name: 'Stomp' }).click();
  await expect.poll(() => general()[MB_GLOBALS.currentMode.at]).toBe(0);

  // Global Tempo: the BPM first (the unit refuses to switch it on without one), then on.
  await dialog.getByRole('slider', { name: /^Tempo/ }).fill('120');
  await expect.poll(() => general()[MB_GLOBALS.tempoBpm.at]).toBe(120);
  await dialog.getByRole('switch', { name: 'Global tempo' }).click();
  await expect.poll(() => general()[MB_GLOBALS.tempoOn.at]).toBe(1);

  // MIDI In Source: TRS only is shown but cannot be picked (the editor's Control Changes need USB).
  const source = dialog.getByRole('combobox', { name: /^MIDI In Source/ });
  await expect(source.locator('option', { hasText: 'TRS only' })).toBeDisabled();
  await source.selectOption({ label: 'USB only' });
  await expect.poll(() => general()[MB_GLOBALS.midiSource.at]).toBe(1);

  await dialog.getByRole('combobox', { name: /^Input channel \(USB\)/ }).selectOption({ label: '5' });
  await expect.poll(() => general()[MB_GLOBALS.midiInUsb.at]).toBe(5);
  await dialog.getByRole('combobox', { name: /^Input channel \(TRS\)/ }).selectOption({ label: '3' });
  await expect.poll(() => general()[MB_GLOBALS.midiInTrs.at]).toBe(3);

  await dialog.getByRole('switch', { name: 'Global EQ on' }).click();
  await expect.poll(() => unit.globals.eqOn).toBe(false);
  await dialog.getByRole('slider', { name: /^Level/ }).fill('70');
  await expect.poll(() => readFloat32LE(unit.globals.eq, 30 * 4)).toBe(70);
  await dialog.getByRole('slider', { name: /^Band 2 · 500 Hz/ }).fill('3');
  await expect.poll(() => readFloat32LE(unit.globals.eq, 14 * 4)).toBe(3);
  await dialog.getByRole('slider', { name: /^Band 4 · 5000 Hz/ }).fill('-5');
  await expect.poll(() => readFloat32LE(unit.globals.eq, 22 * 4)).toBe(-5);
  await expect(dialog.getByText('Lo Cut 80 Hz · Hi Cut 8000 Hz')).toBeVisible();

  // The tuner and tempo controls now go on the unit's channel.
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('combobox', { name: 'MIDI channel' })).toHaveValue('5');
});

test('Global options follows the settings changed on the unit', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  const mode = dialog.getByRole('radiogroup', { name: 'Footswitch mode' });
  await expect(mode.getByRole('radio', { name: 'Preset' })).toHaveAttribute('aria-checked', 'true');
  await fromUnit(page, unit.onUnitGlobal('currentMode', 0));
  await expect(mode.getByRole('radio', { name: 'Stomp' })).toHaveAttribute('aria-checked', 'true');

  await fromUnit(page, unit.onUnitGlobal('tempoBpm', 100)); // the tempo turned on the unit (mb-37)
  await expect(dialog.getByRole('slider', { name: /^Tempo/ })).toHaveValue('100');
});

test('a global write the unit does not confirm is an error, and the unit is read again', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  unit.echoes = false; // the unit takes the write but does not confirm it
  await dialog.getByRole('radiogroup', { name: 'Input mode' }).getByRole('radio', { name: 'Line' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not confirm the write', { timeout: 10_000 });
  // The read after the failure shows what the unit holds (it did take it here).
  await expect(dialog.getByRole('radiogroup', { name: 'Input mode' }).getByRole('radio', { name: 'Line' })).toHaveAttribute('aria-checked', 'true');
});

test('Global Tempo switched on but not accepted on the unit says so', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  await dialog.getByRole('slider', { name: /^Tempo/ }).fill('120');
  await expect.poll(() => unit.globals.general[MB_GLOBALS.tempoBpm.at]).toBe(120);
  unit.echoes = false; // the unit waits for the prompt on its screen to be accepted
  await dialog.getByRole('switch', { name: 'Global tempo' }).click();
  await expect(dialog.getByRole('alert')).toContainText("accept it on the unit's screen", { timeout: 10_000 });
});

test('the folded groups write USB audio, EXP 2, MIDI outputs and clock, Auto CAB and bank select', async ({ page, unit }) => {
  const dialog = await openGlobals(page);
  const general = () => unit.globals.general;
  await dialog.getByRole('switch', { name: 'Auto CAB' }).click(); // the simulated unit starts with it on
  await expect.poll(() => general()[MB_GLOBALS.autoCab.at]).toBe(0);
  await dialog.getByRole('radiogroup', { name: 'Bank select' }).getByRole('radio', { name: 'Immediate' }).click();
  await expect.poll(() => general()[MB_GLOBALS.bankMode.at]).toBe(1);

  // Folded until opened: the less used settings stay out of the way.
  await expect(dialog.getByRole('slider', { name: /^Recording level/ })).toBeHidden();
  await dialog.getByText('USB audio', { exact: true }).click();
  await dialog.getByRole('slider', { name: /^Recording level/ }).fill('-4');
  await expect.poll(() => general()[MB_GLOBALS.usbRecLevel.at]).toBe(0xfc);
  await dialog.getByRole('slider', { name: /^Monitor level/ }).fill('3');
  await expect.poll(() => general()[MB_GLOBALS.usbMonitorLevel.at]).toBe(3);
  await dialog.getByRole('switch', { name: 'Record AUX IN too' }).click();
  await expect.poll(() => general()[MB_GLOBALS.usbRecAux.at]).toBe(0);
  await dialog.getByRole('radiogroup', { name: 'Recording L' }).getByRole('radio', { name: 'Dry' }).click();
  await expect.poll(() => general()[MB_GLOBALS.usbRecWetL.at]).toBe(0);

  await dialog.getByText('EXP 2 and external footswitches', { exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'External footswitch 1' })).toHaveCount(0);
  await dialog.getByRole('radiogroup', { name: 'EXP 2 jack' }).getByRole('radio', { name: 'Two footswitches' }).click();
  await expect.poll(() => general()[MB_GLOBALS.exp2Jack.at]).toBe(2);
  await dialog.getByRole('combobox', { name: 'External footswitch 1' }).selectOption({ label: 'Tap tempo' });
  await expect.poll(() => general()[MB_GLOBALS.extFs1.at]).toBe(8);
  await dialog.getByRole('combobox', { name: 'External footswitch 2' }).selectOption({ label: 'Tuner' });
  await expect.poll(() => general()[MB_GLOBALS.extFs2.at]).toBe(7);

  await dialog.getByText('MIDI outputs and clock', { exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Output channel (USB)' }).selectOption({ label: 'Off' });
  await expect.poll(() => [general()[MB_GLOBALS.midiOutUsb.at], general()[MB_GLOBALS.midiOutUsb.at + 1]]).toEqual([0xff, 0xff]);
  await dialog.getByRole('combobox', { name: 'Output channel (TRS)' }).selectOption({ label: '2' });
  await expect.poll(() => general()[MB_GLOBALS.midiOutTrs.at]).toBe(2);
  await dialog.getByRole('combobox', { name: 'Clock source' }).selectOption({ label: 'Internal' });
  await expect.poll(() => general()[MB_GLOBALS.clockSource.at]).toBe(0);
  await dialog.getByRole('switch', { name: 'Send clock (USB)' }).click();
  await expect.poll(() => general()[MB_GLOBALS.clockOut.at]).toBe(2);
  await dialog.getByRole('switch', { name: 'Send clock (TRS)' }).click();
  await expect.poll(() => general()[MB_GLOBALS.clockOut.at]).toBe(3);
});
