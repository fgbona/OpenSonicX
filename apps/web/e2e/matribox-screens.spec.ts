/**
 * Pictures of the Matribox editor for a design review, against the simulated unit and the invented
 * catalog: MB_SCREENS=<folder> npx playwright test e2e/matribox-screens.spec.ts. Skipped otherwise.
 */
import { devices } from '@playwright/test';
import { connectMatribox, expect, pickCatalog, test } from './matribox-fixtures.ts';

const DIR = process.env.MB_SCREENS;
test.skip(!DIR, 'set MB_SCREENS to a folder to take the pictures');
test.use({ viewport: { width: 1440, height: 1000 } });

const shot = (name: string) => `${DIR}/${name}.png`;

for (const theme of ['dark', 'light'] as const) {
  test(`desktop, ${theme} theme`, async ({ page }) => {
    await connectMatribox(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.screenshot({ path: shot(`desktop-${theme}-no-catalog`), fullPage: true });
    await pickCatalog(page);
    await expect(page.locator('.face-amp')).toHaveAttribute('data-skin', 'marshall');
    await page.screenshot({ path: shot(`desktop-${theme}`), fullPage: true });
    await page.locator('section.preset').screenshot({ path: shot(`amp-block-${theme}`) });
  });
}

test('model picker open, and a non-amp block', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await page.getByRole('button', { name: /^Edit 2\. DRV/ }).click();
  await page.screenshot({ path: shot('drv-block-dark'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });
  await page.getByRole('button', { name: '2. DRV model' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.screenshot({ path: shot('model-picker-dark'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });
});

test('footswitch, expression and tuner panels', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await page.getByText('Expression pedal').click();
  const panels = page.locator('.fold');
  await panels.first().scrollIntoViewIfNeeded();
  const first = (await panels.first().boundingBox())!;
  const last = (await panels.nth(2).boundingBox())!;
  await page.screenshot({ path: shot('panels-dark'), fullPage: true, clip: { x: 0, y: first.y - 12, width: 1440, height: last.y + last.height - first.y + 24 } });
});

test.describe('phone', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);
  test('portrait', async ({ page }) => {
    await connectMatribox(page);
    await pickCatalog(page);
    await page.screenshot({ path: shot('phone-dark') });
    await page.screenshot({ path: shot('phone-dark-full'), fullPage: true });
  });
});
