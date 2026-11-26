/**
 * The rig view preview (?rig=1) on the simulated Matribox: the chain as gear, selection by click
 * and arrow keys, the strip's switch and bars, the full panel on expand, and no WCAG A/AA
 * violations. RIG_SHOTS=<folder> also takes pictures of it (dark, light, phone) and of the icon sheet.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, loadedMatribox, MODELS, test } from './matribox-fixtures.ts';

const SHOTS = process.env.RIG_SHOTS;

async function openRig(page: Page) {
  await page.goto('/?rig=1');
  await expect(loadedMatribox(page)).toBeVisible();
  const rig = page.getByRole('region', { name: 'Rig (preview)' });
  await expect(rig).toBeVisible();
  return rig;
}

const setTheme = (page: Page, theme: 'dark' | 'light') => page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
const gear = (page: Page, position: number, module: string) => page.getByRole('button', { name: new RegExp(`^Edit ${position}\\. ${module}:`) });

test('the classic look stays the default', async ({ page }) => {
  await page.goto('/');
  await expect(loadedMatribox(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toHaveCount(0);
  await expect(page.locator('.tiles')).toBeVisible();
});

test('the chain shows as gear between IN and OUT; a click selects a block', async ({ page }) => {
  const rig = await openRig(page);
  await expect(rig.locator('.rig-block')).toHaveCount(6);
  await expect(rig.locator('.rig-wire path')).toHaveCount(1);
  await expect(gear(page, 3, 'AMP')).toHaveAttribute('aria-pressed', 'true');
  await gear(page, 2, 'DRV').click();
  await expect(gear(page, 2, 'DRV')).toHaveAttribute('aria-pressed', 'true');
  await expect(rig.locator('.rig-model')).toHaveText(`DRV ${MODELS.drive.name}`);
  await expect(rig.getByRole('slider')).toHaveCount(Math.min(5, MODELS.drive.params.length));
});

test('arrow keys walk the chain', async ({ page }) => {
  await openRig(page);
  await gear(page, 3, 'AMP').focus();
  await page.keyboard.press('ArrowRight');
  await expect(gear(page, 4, 'CAB')).toBeFocused();
  await expect(gear(page, 4, 'CAB')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(gear(page, 2, 'DRV')).toHaveAttribute('aria-pressed', 'true');
});

test("the strip's switch and bars edit the block; expand shows every control", async ({ page }) => {
  const rig = await openRig(page);
  await gear(page, 2, 'DRV').click();
  const on = rig.getByRole('switch', { name: /^2\. DRV (on|off)$/ });
  const was = await on.getAttribute('aria-checked');
  await on.click();
  await expect(on).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  await expect.poll(() => gear(page, 2, 'DRV').evaluate((el) => el.classList.contains('is-off'))).toBe(was === 'true');

  const bar = rig.getByRole('slider').first();
  await expect(bar).toBeEnabled();
  const before = Number(await bar.inputValue());
  await bar.focus();
  await page.keyboard.press(before > Number(await bar.getAttribute('min')) ? 'ArrowLeft' : 'ArrowRight');
  await expect.poll(async () => Number(await bar.inputValue())).not.toBe(before);

  await rig.getByRole('button', { name: 'Show every control of 2. DRV' }).click();
  await expect(page.getByRole('region', { name: '2. DRV block' })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations (${theme} theme)`, async ({ page }) => {
    test.slow();
    await openRig(page);
    await setTheme(page, theme);
    const { violations } = await new AxeBuilder({ page }).include('.rig').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test.describe('pictures', () => {
  test.skip(!SHOTS, 'RIG_SHOTS=<folder> takes them');
  test.use({ viewport: { width: 1280, height: 900 } });

  test('rig view, both themes', async ({ page }) => {
    const rig = await openRig(page);
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      await rig.scrollIntoViewIfNeeded();
      await rig.screenshot({ path: `${SHOTS}/rig-${theme}.png`, animations: 'disabled' });
    }
  });

  test('rig view at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const rig = await openRig(page);
    await setTheme(page, 'dark');
    await rig.scrollIntoViewIfNeeded();
    await rig.screenshot({ path: `${SHOTS}/rig-phone-390.png`, animations: 'disabled' });
  });

  test('icon sheet', async ({ page }) => {
    for (const theme of ['dark', 'light'] as const) {
      await page.goto('/preview/rig-icons');
      await setTheme(page, theme);
      await page.locator('.rig-sheet').screenshot({ path: `${SHOTS}/rig-icons-${theme}.png` });
    }
  });
});
