import { devices } from '@playwright/test';
import { test, expect, connect } from './fixtures.ts';
import type { Page } from '@playwright/test';

// A phone: narrow, touch, no hover (the chain's move arrows stay visible).
const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
test.use(pixel);

async function liveEdit(page: Page) {
  await page.getByRole('switch', { name: 'Live edit' }).tap();
  await expect(page.getByText(/Live edit is on/)).toBeVisible();
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('fits the screen, with the preset list folded away until asked for', async ({ page, pedal }) => {
  await connect(page, pedal);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  const toggle = page.locator('.sidebar-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /Load P10/ })).toBeHidden();

  await toggle.tap();
  await page.getByRole('button', { name: /Load P10/ }).tap();
  await expect(page.getByRole('heading', { name: /P10\s*THR-CLEAN/ })).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test('the chain is reordered with the arrows, since touch has no drag and drop', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  const later = page.getByRole('list', { name: /chain/i }).getByRole('button', { name: /^Move .+ later$/ }).first();
  await expect(later).toBeVisible();
  await later.tap();
  await expect.poll(() => pedal.pedal.received).toContain('edit 44');
});

// Dark glass panels are the containing block of a fixed menu; light ones are not.
for (const theme of ['dark', 'light'] as const) {
  test(`the model menu opens as a sheet inside the screen (${theme} theme)`, async ({ page, pedal }) => {
    await connect(page, pedal);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).tap();
    await liveEdit(page);
    await page.locator('section.block-amp .picker-button').tap();
    const list = page.locator('.picker-list');
    const box = (await list.boundingBox())!;
    const screen = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(screen.width);
    // Fixed 12px above the screen's bottom edge, not to the panel it opened from.
    expect(Math.round(box.y + box.height)).toBe(screen.height - 12);

    await page.getByRole('option', { name: /^Calif DualM\b/ }).tap();
    await expect(page.locator('section.block-amp .face-amp')).toHaveAttribute('data-skin', 'mesa');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
}
