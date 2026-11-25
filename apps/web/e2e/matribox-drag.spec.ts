import { MB_SLOTS, mbMoveBlock, parseMbPreset } from '@pocket-master/core';
import { connectMatribox, expect, expectChain, test } from './matribox-fixtures.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
/** Every move-block write the editor could send. */
const MOVES = new Set(Array.from({ length: MB_SLOTS * MB_SLOTS }, (_, i) => hex(mbMoveBlock(Math.floor(i / MB_SLOTS), i % MB_SLOTS))));
const moves = (unit: { received: readonly string[] }) => unit.received.filter((r) => MOVES.has(r));
const modules = (unit: { editBuffer: Uint8Array }) => parseMbPreset(unit.editBuffer).chain.map((b) => b.moduleIndex);

test('a tile dragged onto another position is one move write; the chain reads back in the new order and Undo restores it', async ({ page, unit }) => {
  await connectMatribox(page);
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL');
  const tiles = page.locator('.tiles .tile-unit');
  await expect(tiles.first()).toHaveAttribute('draggable', 'true');
  await expect(page.locator('.tiles .tile-unit:has(.mb-tile-add)')).not.toHaveAttribute('draggable', 'true');

  await tiles.nth(0).dragTo(tiles.nth(3));
  await expectChain(page, 'DRV → AMP → CAB → DYN → RVB → VOL');
  expect(moves(unit)).toEqual([hex(mbMoveBlock(0, 3))]);
  expect(modules(unit)).toEqual([3, 4, 5, 0, 10, 15]);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL');
  expect(modules(unit)).toEqual([0, 3, 4, 5, 10, 15]);
});

test('a tile dropped on itself or on the add tile writes nothing', async ({ page, unit }) => {
  await connectMatribox(page);
  const tiles = page.locator('.tiles .tile-unit');
  await tiles.nth(1).dragTo(tiles.nth(1));
  await tiles.nth(1).dragTo(page.locator('.tiles .tile-unit:has(.mb-tile-add)'));
  await expect(page.locator('.tile-over')).toHaveCount(0);
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL');
  expect(moves(unit)).toEqual([]);
});
