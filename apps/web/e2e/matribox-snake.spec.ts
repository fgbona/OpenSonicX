/**
 * The Matribox chain wraps into rows (a Helix-like snake) instead of scrolling sideways: a long
 * chain shows whole, its add tile last, at desktop and phone widths. MB_SNAKE=<folder> also takes
 * pictures of it in both themes.
 */
import { devices, type Page } from '@playwright/test';
import { MB_SLOTS, mbMoveBlock } from '@pocket-master/core';
import { connectMatribox, expect, expectChain, test } from './matribox-fixtures.ts';

const SHOTS = process.env.MB_SNAKE;
const CHAIN_10 = 'DYN → DRV → AMP → CAB → RVB → VOL → DLY → DRV → AMP → CAB';
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const MOVES = new Set(Array.from({ length: MB_SLOTS * MB_SLOTS }, (_, i) => hex(mbMoveBlock(Math.floor(i / MB_SLOTS), i % MB_SLOTS))));

/** Adds a block of each type, with the type's first model, from the add tile's two-step menu. */
async function addBlocks(page: Page, types: readonly string[]) {
  const add = page.getByRole('button', { name: 'Add a block…' });
  for (const type of types) {
    await expect(add).toBeEnabled();
    await add.click();
    await page.getByRole('listbox', { name: 'Add a block: type' }).getByRole('option', { name: type, exact: true }).click();
    await page
      .getByRole('listbox', { name: `Add a block: ${type} model` })
      .getByRole('option')
      .nth(1)
      .click();
  }
}

/** The 6-block preset grown to 10 blocks. */
async function longChain(page: Page) {
  await connectMatribox(page);
  await addBlocks(page, ['DLY', 'DRV', 'AMP', 'CAB']);
  await expectChain(page, CHAIN_10);
  await expect(page.getByRole('button', { name: 'Add a block…' })).toBeEnabled(); // the editor is idle
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** The rows the chain's tiles sit on (distinct tops). */
const rows = (page: Page) => page.locator('.tiles > .tile-unit').evaluateAll((units) => new Set(units.map((u) => Math.round(u.getBoundingClientRect().top))).size);

async function expectWholeChain(page: Page) {
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  const strip = page.locator('.tiles');
  expect(await strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const add = page.getByRole('button', { name: 'Add a block…' });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport({ ratio: 1 });
  // The connector runs through every row and turns back at each row's end.
  await expect(page.locator('.mb-snake-line path')).toHaveCount(1);
}

async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.locator('.tiles-wrap').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a 10-block chain shows whole on two rows, its add tile inside the screen', async ({ page }) => {
    await longChain(page);
    await snap(page, 'desktop');
    await expectWholeChain(page);
    expect(await rows(page)).toBe(2);
  });

  test('a tile dragged to the next row is one move write', async ({ page, unit }) => {
    await longChain(page);
    const tiles = page.locator('.tiles .tile-unit');
    const writes = unit.received.length;
    await tiles.nth(0).dragTo(tiles.nth(8));
    await expectChain(page, 'DRV → AMP → CAB → RVB → VOL → DLY → DRV → AMP → DYN → CAB');
    expect(unit.received.slice(writes).filter((r) => MOVES.has(r))).toEqual([hex(mbMoveBlock(0, 8))]);
  });
});

test.describe('phone', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('a 10-block chain wraps onto more rows with no sideways scroll', async ({ page }) => {
    await longChain(page);
    await snap(page, 'phone');
    await expectWholeChain(page);
    expect(await rows(page)).toBeGreaterThan(2);
  });
});
