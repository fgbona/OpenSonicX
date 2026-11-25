import { devices, type Page } from '@playwright/test';
import { parseMbPreset, writeMatriboxPrst } from '@pocket-master/core';
import { blockPanel, connectMatribox, expect, expectChain, MODELS, optionName, test } from './matribox-fixtures.ts';

// A phone: narrow, touch, no hover (the chain's move arrows stay visible).
const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
test.use(pixel);

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('the Matribox editor fits the screen, with the preset list folded away until asked for', async ({ page, unit }) => {
  await connectMatribox(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  const toggle = page.locator('.sidebar-toggle');
  await expect(toggle).toHaveText('Presets · 17C Drive AD');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /Load 1A/ })).toBeHidden();

  await toggle.tap();
  await page.getByRole('button', { name: /Load 1A/ }).tap();
  await expect.poll(() => unit.current).toBe(0);
  await expect(page.getByRole('heading', { name: /^1A/ })).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test('the chain wraps into rows with no sideways scroll, its add tile on screen; arrows move a block', async ({ page, unit }) => {
  await connectMatribox(page);
  const strip = page.locator('.tiles');
  expect(await strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Show later blocks' })).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Add a block…' });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport({ ratio: 1 });
  expect(await sideways(page)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Move block 6 earlier in the chain' }).tap();
  await expectChain(page, 'DYN → DRV → AMP → CAB → VOL → RVB');
  expect(parseMbPreset(unit.editBuffer).chain.map((b) => b.moduleIndex)).toEqual([0, 3, 4, 5, 15, 10]);
});

test('the model menu opens as a sheet inside the screen and the panels fit', async ({ page }) => {
  await connectMatribox(page);
  const drive = await blockPanel(page, 2, 'DRV');
  await drive.getByRole('button', { name: '2. DRV model' }).tap();
  const box = (await page.locator('.picker-list').boundingBox())!;
  const screen = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(screen.width);
  expect(Math.round(box.y + box.height)).toBe(screen.height - 12);
  await page.getByRole('option', { name: optionName(MODELS.od) }).tap();
  await expect(drive.getByRole('button', { name: '2. DRV model' })).toContainText(MODELS.od.name);

  // The add menu's two steps are the same sheet.
  await page.getByRole('button', { name: 'Add a block…' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Add a block…' }).tap();
  await page.getByRole('listbox', { name: 'Add a block: type' }).getByRole('option', { name: 'AMP', exact: true }).tap();
  const sheet = (await page.getByRole('listbox', { name: 'Add a block: AMP model' }).boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(0);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(screen.width);
  expect(Math.round(sheet.y + sheet.height)).toBe(screen.height - 12);
  await page.getByRole('option', { name: /Back to block types/ }).tap();
  await expect(page.getByRole('listbox', { name: 'Add a block: type' })).toBeFocused();
  await page.keyboard.press('Escape');

  await page.getByText('Expression pedal').tap();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  for (const control of [page.getByRole('switch', { name: 'Footswitch D toggles 6. VOL' }), page.getByRole('button', { name: 'Set BPM' })]) {
    await control.scrollIntoViewIfNeeded();
    const b = (await control.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(screen.width);
  }
});

test('tiles do not drag on touch, and a swipe on the chain scrolls the page', async ({ page }) => {
  await connectMatribox(page);
  for (const tile of await page.locator('.tiles .tile-unit').all()) await expect(tile).not.toHaveAttribute('draggable', 'true');
  await expect(page.locator('.tiles')).toHaveCSS('touch-action', 'auto');
});

/** Vertical overlap of two boxes: they sit on the same row. */
const sameRow = (a: { y: number; height: number }, b: { y: number; height: number }) => a.y < b.y + b.height && b.y < a.y + a.height;

test('the preset header fits one row: secondary actions fold into a More menu that works', async ({ page, unit }) => {
  await connectMatribox(page);
  const head = page.locator('.preset-head');
  const more = head.getByRole('button', { name: 'More actions' });
  const box = async (name: string) => (await head.getByRole('button', { name, exact: true }).boundingBox())!;
  const save = await box('Save…');
  expect(sameRow(await box('Undo'), save)).toBe(true);
  expect(sameRow(save, (await more.boundingBox())!)).toBe(true);
  expect(sameRow(save, (await head.getByRole('slider', { name: 'Patch volume' }).boundingBox())!)).toBe(true);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await expect(head.getByRole('button', { name: 'Export preset' })).toBeHidden();
  await expect(head.getByRole('button', { name: 'Read', exact: true })).toBeHidden();

  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.tap();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const download = page.waitForEvent('download');
  await head.getByRole('button', { name: 'Export preset' }).tap();
  expect((await download).suggestedFilename()).toBe('17C Drive AD.prst');
  await expect(head.getByRole('button', { name: 'Export preset' })).toBeHidden();

  await more.tap();
  const reads = unit.received.length;
  await head.getByRole('button', { name: 'Read', exact: true }).tap();
  await expect.poll(() => unit.received.length).toBeGreaterThan(reads);
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // Import picks its file from the folded menu; its dialog still opens.
  const file = { name: 'drive.prst', mimeType: 'application/octet-stream', buffer: Buffer.from(writeMatriboxPrst(parseMbPreset(unit.editBuffer))) };
  await page.getByLabel('Choose a Matribox preset file (.prst)').setInputFiles(file);
  await expect(page.getByRole('dialog', { name: 'Import a preset file' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Import a preset file' })).toBeHidden();

  await more.tap();
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toBeFocused();
});

test('the folded menu’s import is a button the keyboard reaches and opens the file picker', async ({ page }) => {
  await connectMatribox(page);
  const head = page.locator('.preset-head');
  await expect(head.getByRole('button', { name: 'Read', exact: true, includeHidden: true })).toBeEnabled(); // the editor is idle
  await head.getByRole('button', { name: 'More actions' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); // Export preset
  await page.keyboard.press('Tab');
  await expect(head.getByRole('button', { name: 'Import preset…' })).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await chooser;
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test('the More menu speaks Portuguese', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '17C Drive AD' })).toBeVisible();
    await page.getByRole('button', { name: 'Mais ações' }).tap();
    await expect(page.getByRole('button', { name: 'Exportar preset' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ler', exact: true })).toBeVisible();
  });
});
