import { parseMbPreset } from '@pocket-master/core';
import type { Page } from '@playwright/test';
import { blockPanel, connectMatribox, expect, pickCatalog, test } from './matribox-fixtures.ts';

/** Delivers a frame the simulated unit sends on its own (no request from the editor). */
const fromUnit = (page: Page, frame: Uint8Array) => page.evaluate((bytes) => window.__midi.receive('Matribox II PRO', bytes), Array.from(frame));

test('the editor follows what is done on the unit: a block toggled, another preset loaded', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const drive = await blockPanel(page, 2, 'DRV');
  await expect(drive.getByRole('switch', { name: '2. DRV off' })).toBeVisible();

  // A footswitch on the unit turns the drive on: the editor shows it without reading.
  const slot = parseMbPreset(unit.editBuffer).chain[1]!.slot;
  const reads = unit.received.length;
  await fromUnit(page, unit.onUnit([0x02, 0x00, 0x05, 0x01, slot, 0, 0, 0, 1, 0, 0, 0]));
  await expect(drive.getByRole('switch', { name: '2. DRV on' })).toBeVisible();
  expect(unit.received.length).toBe(reads);

  // The unit loads 17D by itself, and says so twice: the editor reads the new preset once.
  const notice = unit.onUnit([0x01, 0x00, 0x0a, 0x01, 0x43, 0, 0, 0]);
  await fromUnit(page, notice);
  await fromUnit(page, notice);
  await expect(page.getByRole('heading', { name: /^17D/ })).toBeVisible();
  expect(unit.received.length).toBe(reads + 2); // current-preset number, then the preset
});
