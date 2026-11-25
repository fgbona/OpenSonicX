import { devices, type Page } from '@playwright/test';
import { parseMbPreset } from '@pocket-master/core';
import { blockPanel, connectMatribox, expect, expectChain, pickCatalog, test } from './matribox-fixtures.ts';

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

test('the chain strip swipes sideways and pages with its buttons; arrows move a block', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const strip = page.locator('.tiles');
  await expect(strip).toHaveCSS('touch-action', 'pan-x');
  const later = page.getByRole('button', { name: 'Show later blocks' });
  await expect(page.getByRole('button', { name: 'Show earlier blocks' })).toHaveCount(0);
  for (let i = 0; i < 6 && (await later.isVisible()); i++) {
    await later.tap();
    await page.waitForTimeout(400); // smooth scroll
  }
  await expect(page.getByRole('button', { name: 'Add a block…' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Show earlier blocks' })).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Move block 6 earlier in the chain' }).tap();
  await expectChain(page, 'DYN → DRV → AMP → CAB → VOL → RVB');
  expect(parseMbPreset(unit.editBuffer).chain.map((b) => b.moduleIndex)).toEqual([0, 3, 4, 5, 15, 10]);
});

test('the model menu opens as a sheet inside the screen and the panels fit', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const drive = await blockPanel(page, 2, 'DRV');
  await drive.getByRole('button', { name: '2. DRV model' }).tap();
  const box = (await page.locator('.picker-list').boundingBox())!;
  const screen = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(screen.width);
  expect(Math.round(box.y + box.height)).toBe(screen.height - 12);
  await page.getByRole('option', { name: /^Fake Fuzz/ }).tap();
  await expect(drive.getByRole('button', { name: '2. DRV model' })).toContainText('Fake Fuzz');

  await page.getByText('Expression pedal').tap();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  for (const control of [page.getByRole('switch', { name: 'Footswitch D toggles 6. VOL' }), page.getByRole('button', { name: 'Set BPM' })]) {
    await control.scrollIntoViewIfNeeded();
    const b = (await control.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(screen.width);
  }
});
