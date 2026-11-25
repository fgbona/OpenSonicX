/**
 * Pictures of the Matribox editor for a design review, against the simulated unit and the invented
 * catalog: MB_SCREENS=<folder> npx playwright test e2e/matribox-screens.spec.ts. Skipped otherwise.
 */
import { devices, type Page, type PageScreenshotOptions } from '@playwright/test';
import { blockPanel, connectMatribox, expect, pickCatalog, test } from './matribox-fixtures.ts';

const DIR = process.env.MB_SCREENS;
test.skip(!DIR, 'set MB_SCREENS to a folder to take the pictures');
test.use({ viewport: { width: 1440, height: 1000 } });

const SCREEN = { x: 0, y: 0, width: 1440, height: 1000 };

/** A picture once the editor is idle (Read enabled), not mid-read with its buttons dimmed. */
async function snap(page: Page, name: string, options: PageScreenshotOptions = { fullPage: true }) {
  await expect(page.getByRole('button', { name: 'Read', exact: true })).toBeEnabled();
  await page.screenshot({ ...options, path: `${DIR}/${name}.png` });
}

for (const theme of ['dark', 'light'] as const) {
  test(`desktop, ${theme} theme`, async ({ page }) => {
    await connectMatribox(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await snap(page, `desktop-${theme}-no-catalog`);
    await pickCatalog(page);
    await expect(page.locator('.face-amp')).toHaveAttribute('data-skin', 'marshall');
    await snap(page, `desktop-${theme}`);
    await expect(page.getByRole('button', { name: 'Read', exact: true })).toBeEnabled();
    await page.locator('section.preset').screenshot({ path: `${DIR}/amp-block-${theme}.png` });
  });
}

test('model picker open, and a non-amp block', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const drive = await blockPanel(page, 2, 'DRV');
  await snap(page, 'drv-block-dark', { clip: SCREEN });
  await drive.getByRole('button', { name: '2. DRV model' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await snap(page, 'model-picker-dark', { clip: SCREEN });
});

test('footswitch, expression and tuner panels', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await page.getByText('Expression pedal').click();
  const panels = page.locator('.fold');
  const first = (await panels.first().boundingBox())!;
  const last = (await panels.nth(2).boundingBox())!;
  await snap(page, 'panels-dark', { fullPage: true, clip: { x: 0, y: first.y - 12, width: 1440, height: last.y + last.height - first.y + 24 } });
});

test.describe('phone', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);
  test('portrait', async ({ page }) => {
    await connectMatribox(page);
    await pickCatalog(page);
    await snap(page, 'phone-dark', {});
    await snap(page, 'phone-dark-full');
  });
});
