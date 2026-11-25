import { parseMbPreset, wrapMbMessage } from '@pocket-master/core';
import { replyFrames } from '../../../packages/core/test/fake-matribox.ts';
import type { Page } from '@playwright/test';
import { blockPanel, connectMatribox, expect, settled, test } from './matribox-fixtures.ts';

/** Delivers a frame the simulated unit sends on its own (no request from the editor). */
const fromUnit = (page: Page, frame: Uint8Array) => page.evaluate((bytes) => window.__midi.receive('Matribox II PRO', bytes), Array.from(frame));

test('the editor follows what is done on the unit: a block toggled, another preset loaded', async ({ page, unit }) => {
  await connectMatribox(page);
  const drive = await blockPanel(page, 2, 'DRV');
  await expect(drive.getByRole('switch', { name: '2. DRV off' })).toBeVisible();

  // A footswitch on the unit turns the drive on: the editor shows it without reading.
  const slot = parseMbPreset(unit.editBuffer).chain[1]!.slot;
  await settled(unit);
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

test('the editor follows a model changed and a preset saved on the unit', async ({ page, unit }) => {
  await connectMatribox(page);
  // The model knob of a block screen: a chain notice per model passed; the editor reads the preset again.
  await settled(unit);
  const reads = unit.received.length;
  const chain = replyFrames(wrapMbMessage(1, 0x10, [0x00, 0x00, 0x04, 0x01, ...new Uint8Array(85)]))[0] as Uint8Array;
  await fromUnit(page, chain);
  await settled(unit);
  expect(unit.received.length).toBe(reads + 2); // current-preset number, then the preset

  // Saved on the unit to 17C under another name: the header shows it.
  const name = [...'SAVED ON UNIT'].map((c) => c.charCodeAt(0));
  await fromUnit(page, replyFrames(wrapMbMessage(1, 0x05, [0x42, 0, 0, 0, ...name, ...new Uint8Array(17 - name.length)]))[0] as Uint8Array);
  await expect(page.getByRole('heading', { name: '17C SAVED ON UNIT' })).toBeVisible();
});
