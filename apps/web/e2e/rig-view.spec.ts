/**
 * The rig view ("New look (preview)" in the settings, or ?rig=1) on the simulated Matribox: the
 * chain as gear with module tags, selection by click and arrow keys, drag / Alt+arrows / strip
 * arrows to reorder, the add slot, remove, Undo, the DSP load, the settings switch, and no WCAG
 * A/AA violations. RIG_SHOTS=<folder> also takes the design pictures.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { parseMbPreset } from '@pocket-master/core';
import { expect, loadedMatribox, MODELS, optionName, test } from './matribox-fixtures.ts';

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
/** The chain as the gear's tags name it, once it shows exactly that. */
const expectRig = (page: Page, modules: string) => expect.poll(async () => (await page.locator('.rig-tag').allTextContents()).join(' → ')).toBe(modules);
const modules = (unit: { editBuffer: Uint8Array }) => parseMbPreset(unit.editBuffer).chain.map((b) => b.moduleIndex);
const START = 'DYN → DRV → AMP → CAB → RVB → VOL';

test('the classic look stays the default', async ({ page }) => {
  await page.goto('/');
  await expect(loadedMatribox(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toHaveCount(0);
  await expect(page.locator('.tiles')).toBeVisible();
});

test('the settings switch turns the new look on, the browser keeps it, and it turns off again', async ({ page }) => {
  await page.goto('/');
  await expect(loadedMatribox(page)).toBeVisible();
  await page.getByRole('button', { name: 'Global options' }).click();
  const look = page.getByRole('switch', { name: 'New look (preview)' });
  await expect(look).toHaveAttribute('aria-checked', 'false');
  await look.click();
  await expect(look).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the classic look' }).click();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toHaveCount(0);
  await page.reload();
  await expect(loadedMatribox(page)).toBeVisible();
  await expect(page.locator('.tiles')).toBeVisible();
});

test('the look still switches when the browser blocks storage', async ({ page }) => {
  await page.addInitScript(() => {
    const deny = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { get: deny });
  });
  await page.goto('/');
  await expect(loadedMatribox(page)).toBeVisible();
  await page.getByRole('button', { name: 'Global options' }).click();
  await page.getByRole('switch', { name: 'New look (preview)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Rig (preview)' })).toBeVisible();
});

test('the chain shows as tagged gear between IN and OUT, with the DSP load; a click selects a block', async ({ page }) => {
  const rig = await openRig(page);
  await expect(rig.locator('.rig-block')).toHaveCount(6);
  await expectRig(page, START);
  await expect(rig.locator('.rig-wire path')).toHaveCount(1);
  await expect(rig.getByRole('meter')).toBeVisible();
  await expect(gear(page, 3, 'AMP')).toHaveAttribute('aria-pressed', 'true');
  await gear(page, 2, 'DRV').click();
  await expect(gear(page, 2, 'DRV')).toHaveAttribute('aria-pressed', 'true');
  // The real gear leads the strip ("Based on …"); our model name follows, smaller.
  const model = rig.locator('.rig-model');
  if (MODELS.drive.basedOn) {
    await expect(model).toContainText(`DRV Based on ${MODELS.drive.basedOn}`);
    await expect(model.locator('.rig-model-name')).toHaveText(MODELS.drive.name);
    await expect(gear(page, 2, 'DRV')).toHaveAccessibleName(`Edit 2. DRV: ${MODELS.drive.name}, Based on ${MODELS.drive.basedOn}`);
  } else await expect(model).toHaveText(`DRV ${MODELS.drive.name}`);
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

test('a gear dragged onto another place moves the block; Undo puts it back', async ({ page, unit }) => {
  const rig = await openRig(page);
  const items = rig.locator('.rig-list > li[draggable="true"]');
  await expect(items).toHaveCount(6);
  await items.nth(0).dragTo(items.nth(3));
  await expectRig(page, 'DRV → AMP → CAB → DYN → RVB → VOL');
  expect(modules(unit)).toEqual([3, 4, 5, 0, 10, 15]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expectRig(page, START);
});

test('Alt+arrows and the strip arrows move the selected block without a mouse', async ({ page }) => {
  const rig = await openRig(page);
  // Moves wait for the editor's first read to end (the gear is not movable while it is busy).
  await expect(rig.getByRole('button', { name: 'Add a block…' })).toBeEnabled();
  await gear(page, 2, 'DRV').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expectRig(page, 'DYN → AMP → DRV → CAB → RVB → VOL');
  await expect(gear(page, 3, 'DRV')).toBeFocused();

  await gear(page, 3, 'DRV').click();
  await rig.getByRole('button', { name: 'Move 3. DRV earlier' }).click();
  await expectRig(page, START);
  await expect(rig.getByRole('button', { name: 'Move 1. DYN earlier' })).toHaveCount(0);
  await gear(page, 1, 'DYN').click();
  await expect(rig.getByRole('button', { name: 'Move 1. DYN earlier' })).toBeDisabled();
});

test('the add slot opens the model picker and adds the block before OUT; remove and Undo', async ({ page }) => {
  const rig = await openRig(page);
  await rig.getByRole('button', { name: 'Add a block…' }).click();
  await page.getByRole('option', { name: 'DLY' }).click();
  await page.getByRole('option', { name: optionName(MODELS.echo) }).click();
  await expectRig(page, `${START} → DLY`);
  await expect(gear(page, 7, 'DLY')).toHaveAttribute('aria-pressed', 'true');

  await rig.getByRole('button', { name: 'Remove 7. DLY from the chain' }).click();
  await expectRig(page, START);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expectRig(page, `${START} → DLY`);
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

test('at phone width the two-row snake fits with its tags, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rig = await openRig(page);
  await expectRig(page, START);
  await expect(rig.locator('.rig-tag').first()).toBeVisible();
  const rows = await rig.locator('.rig-list > li').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(rows).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations (${theme} theme)`, async ({ page }) => {
    test.slow();
    await openRig(page);
    await setTheme(page, theme);
    // A bypassed block too: its tag dims with the drawing.
    await gear(page, 2, 'DRV').click();
    await page.getByRole('switch', { name: /^2\. DRV (on|off)$/ }).click();
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
      await rig.screenshot({ path: `${SHOTS}/matribox-${theme}.png`, animations: 'disabled' });
    }
  });

  test('while dragging', async ({ page }) => {
    const rig = await openRig(page);
    await setTheme(page, 'dark');
    const items = rig.locator('.rig-list > li[draggable="true"]');
    const data = await page.evaluateHandle(() => new DataTransfer());
    await items.nth(1).dispatchEvent('dragstart', { dataTransfer: data });
    await items.nth(4).dispatchEvent('dragover', { dataTransfer: data });
    await expect(rig.locator('.tile-over')).toHaveCount(1);
    await rig.screenshot({ path: `${SHOTS}/matribox-dragging.png`, animations: 'disabled' });
    await items.nth(1).dispatchEvent('dragend', { dataTransfer: data });
  });

  test('detail strip, based-on line', async ({ page }) => {
    const rig = await openRig(page);
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      await gear(page, 2, 'DRV').click();
      await rig.locator('.rig-detail').screenshot({ path: `${SHOTS}/strip-based-on-${theme}.png`, animations: 'disabled' });
    }
  });

  test('add picker', async ({ page }) => {
    const rig = await openRig(page);
    await setTheme(page, 'dark');
    await rig.getByRole('button', { name: 'Add a block…' }).click();
    await expect(page.getByRole('option', { name: 'DLY' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/matribox-add-picker.png`, animations: 'disabled', fullPage: true });
  });

  test('settings switch', async ({ page }) => {
    await page.goto('/');
    await expect(loadedMatribox(page)).toBeVisible();
    await setTheme(page, 'dark');
    await page.getByRole('button', { name: 'Global options' }).click();
    await page.getByRole('switch', { name: 'New look (preview)' }).click();
    await page.getByRole('dialog').screenshot({ path: `${SHOTS}/settings-switch.png`, animations: 'disabled' });
  });

  test('rig view at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const rig = await openRig(page);
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      await rig.scrollIntoViewIfNeeded();
      await rig.screenshot({ path: `${SHOTS}/phone-390-${theme}.png`, animations: 'disabled' });
    }
  });

  test('module label, under or inside the drawing', async ({ page }) => {
    for (const [name, url] of [
      ['label-under', '/?rig=1'],
      ['label-inside', '/?rig=1&rigtag=inside'],
    ] as const) {
      await page.goto(url);
      await expect(loadedMatribox(page)).toBeVisible();
      await setTheme(page, 'dark');
      const chain = page.locator('.rig-chain');
      await chain.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
      await setTheme(page, 'light');
      await chain.screenshot({ path: `${SHOTS}/${name}-light.png`, animations: 'disabled' });
    }
  });

  test('icon sheet', async ({ page }) => {
    for (const theme of ['dark', 'light'] as const) {
      await page.goto('/preview/rig-icons');
      await setTheme(page, theme);
      await page.locator('.rig-sheet').screenshot({ path: `${SHOTS}/icons-${theme}.png` });
    }
  });
});
