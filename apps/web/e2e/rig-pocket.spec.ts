/**
 * The rig view on the simulated Pocket Master: its nine fixed blocks as tagged gear, selection,
 * the strip's switch and bars (through the same edits as the classic editor), every control on
 * expand, the settings switch, and no WCAG A/AA violations. RIG_SHOTS=<folder> takes its pictures.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { connect, expect, test } from './fixtures.ts';
import { RIG_LOOK_KEY } from '../lib/rigLook.ts';

const SHOTS = process.env.RIG_SHOTS;
const setTheme = (page: Page, theme: 'dark' | 'light') => page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
const gear = (page: Page, module: string) => page.getByRole('button', { name: new RegExp(`^Edit ${module}:`) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), RIG_LOOK_KEY);
});

test('the Pocket Master chain shows as gear with its module tags; blocks cannot be added or moved', async ({ page, pedal }) => {
  await connect(page, pedal);
  const rig = page.getByRole('region', { name: 'Rig (preview)' });
  await expect(rig).toBeVisible();
  await expect(rig.locator('.rig-block')).toHaveCount(9);
  // The order is the preset's; the nine modules are fixed.
  expect((await rig.locator('.rig-tag').allTextContents()).sort()).toEqual(['AMP', 'DLY', 'DRV', 'EQ', 'FX1', 'FX2', 'IR', 'NR', 'RVB']);
  await expect(gear(page, 'AMP')).toHaveAttribute('aria-pressed', 'true');
  await expect(rig.getByRole('button', { name: 'Add a block…' })).toHaveCount(0);
  await expect(rig.getByRole('button', { name: /^Move / })).toHaveCount(0);
  await expect(rig.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(rig.locator('.rig-list > li[draggable="true"]')).toHaveCount(0);
});

test("the strip's switch and bars edit the Pocket Master block; expand shows its editor", async ({ page, pedal }) => {
  await connect(page, pedal);
  const rig = page.getByRole('region', { name: 'Rig (preview)' });
  await gear(page, 'DRV').click();
  await expect(gear(page, 'DRV')).toHaveAttribute('aria-pressed', 'true');
  const on = rig.getByRole('switch', { name: /^DRV (on|off)$/ });
  const was = await on.getAttribute('aria-checked');
  await on.click();
  await expect(on).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');

  await gear(page, 'AMP').click();
  const bar = rig.getByRole('slider').first();
  await expect(bar).toBeEnabled();
  const before = Number(await bar.inputValue());
  await bar.focus();
  await page.keyboard.press(before > Number(await bar.getAttribute('min')) ? 'ArrowLeft' : 'ArrowRight');
  await expect.poll(async () => Number(await bar.inputValue())).not.toBe(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await rig.getByRole('button', { name: 'Show every control of AMP' }).click();
  await expect(page.getByRole('region', { name: 'AMP block' })).toBeVisible();
});

test('the Pocket Master settings turn the new look off', async ({ page, pedal }) => {
  await connect(page, pedal);
  await page.getByRole('button', { name: 'Global options' }).click();
  const look = page.getByRole('switch', { name: 'New look (preview)' });
  await expect(look).toHaveAttribute('aria-checked', 'true');
  await look.click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toHaveCount(0);
  await expect(page.locator('.tiles')).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`Pocket Master rig: no WCAG A/AA violations (${theme} theme)`, async ({ page, pedal }) => {
    test.slow();
    await connect(page, pedal);
    await setTheme(page, theme);
    const { violations } = await new AxeBuilder({ page }).include('.rig').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test.describe('pictures', () => {
  test.skip(!SHOTS, 'RIG_SHOTS=<folder> takes them');
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Pocket Master rig view, both themes', async ({ page, pedal }) => {
    await connect(page, pedal);
    const rig = page.getByRole('region', { name: 'Rig (preview)' });
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      await rig.scrollIntoViewIfNeeded();
      await rig.screenshot({ path: `${SHOTS}/pocket-master-${theme}.png`, animations: 'disabled' });
    }
  });
});
