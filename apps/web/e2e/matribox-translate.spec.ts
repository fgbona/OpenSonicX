/**
 * The Matribox model description in Portuguese, translated on the device by a stubbed Translator API
 * (invented descriptions; the real catalog is the user's file). Never touches a real model.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { en, pt } from '../lib/messages.ts';
import { CATALOG_FILE, expect, test } from './matribox-fixtures.ts';

const DESCRIPTION = 'A mid-boost overdrive.'; // the invented catalog's Fake Drive
const STUB = (availability: string) => `
  window.Translator = {
    availability: async () => '${availability}',
    create: async () => ({ translate: async (text) => 'PT-STUB ' + text }),
  };`;

async function open(page: Page, lang: 'en' | 'pt', stub?: string) {
  await page.addInitScript(`try { localStorage.setItem('pocket-master-editor.lang', '${lang}'); } catch {}`);
  if (stub) await page.addInitScript(stub);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '17C Drive AD' })).toBeVisible();
  await page.getByLabel(lang === 'pt' ? pt['mb.catalogPick'] : en['mb.catalogPick']).setInputFiles(CATALOG_FILE);
  const tile = lang === 'pt' ? /^Editar 2\. DRV:/ : /^Edit 2\. DRV:/;
  await page.getByRole('button', { name: tile }).click();
  return page.locator('section.editor.mb-drv');
}

test('PT with a Translator: the translation and the note', async ({ page }) => {
  const panel = await open(page, 'pt', STUB('available'));
  await expect(panel.locator('.editor-info')).toContainText(`PT-STUB ${DESCRIPTION}`);
  await expect(panel.locator('.editor-info')).toContainText(pt['mb.translated']);
});

test('EN keeps the original, with no note', async ({ page }) => {
  const panel = await open(page, 'en', STUB('available'));
  await expect(panel.locator('.editor-info')).toContainText(DESCRIPTION);
  await expect(panel.locator('.editor-info')).not.toContainText('PT-STUB');
  await expect(panel.locator('.editor-info')).not.toContainText(en['mb.translated']);
});

test('PT without a Translator: English and "(em inglês)"', async ({ page }) => {
  // Playwright's Chromium may define a Translator of its own; this browser has none.
  const panel = await open(page, 'pt', 'window.Translator = undefined;');
  await expect(panel.locator('.editor-info')).toContainText(DESCRIPTION);
  await expect(panel.locator('.editor-info')).toContainText('(em inglês)');
});

test('PT with a model to download: a button starts it, then the translation shows', async ({ page }) => {
  const panel = await open(page, 'pt', STUB('downloadable'));
  await expect(panel.locator('.editor-info')).toContainText(DESCRIPTION);
  await panel.getByRole('button', { name: pt['mb.translateButton'] }).click();
  await expect(panel.locator('.editor-info')).toContainText(`PT-STUB ${DESCRIPTION}`);
});

for (const theme of ['dark', 'light'] as const) {
  test(`the panel with the translation has no WCAG A/AA violations (${theme} theme)`, async ({ page }) => {
    const panel = await open(page, 'pt', STUB('available'));
    if (theme === 'light') await page.getByRole('button', { name: pt['theme.toLight'] }).click();
    await expect(panel.locator('.editor-info')).toContainText(pt['mb.translated']);
    const results = await new AxeBuilder({ page }).include('.editor.mb-drv').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
}
