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

/** The editor is idle once Read is enabled; on a phone it sits in the folded More menu, hence includeHidden. */
const idle = (page: Page) => expect(page.getByRole('button', { name: 'Read', exact: true, includeHidden: true })).toBeEnabled();

/** A picture once the editor is idle (Read enabled), not mid-read with its buttons dimmed. */
async function snap(page: Page, name: string, options: PageScreenshotOptions = { fullPage: true }) {
  await idle(page);
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
    await idle(page);
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

test("add menu: block types, then a module's models", async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await page.getByRole('button', { name: 'Add a block…' }).click();
  await expect(page.getByRole('listbox', { name: 'Add a block: type' })).toBeVisible();
  await snap(page, 'add-types-dark', { clip: SCREEN });
  await page.getByRole('listbox', { name: 'Add a block: type' }).getByRole('option', { name: 'DRV', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Add a block: DRV model' })).toBeVisible();
  await snap(page, 'add-models-dark', { clip: SCREEN });
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

/** Two kept tones in the tone library, the panel scrolled into view. */
async function keepTones(page: Page) {
  const library = page.getByRole('region', { name: 'Tone library' });
  await library.getByRole('textbox', { name: 'Name' }).fill('Crunch');
  await library.getByRole('textbox', { name: 'Notes' }).fill('AC/DC, Back in Black, rhythm');
  await library.getByRole('button', { name: 'Keep tone' }).click();
  await expect(library.getByRole('status')).toContainText('Crunch');
  await library.getByRole('textbox', { name: 'Name' }).fill('Lead');
  await library.getByRole('button', { name: 'Keep tone' }).click();
  await expect(library.getByRole('listitem')).toHaveCount(2);
  await library.scrollIntoViewIfNeeded();
  return library;
}

for (const theme of ['dark', 'light'] as const) {
  test(`tone library, ${theme} theme`, async ({ page }) => {
    await connectMatribox(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await pickCatalog(page);
    const library = await keepTones(page);
    await idle(page);
    await library.screenshot({ path: `${DIR}/library-desktop-${theme}.png` });
  });
}

test.describe('phone', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);
  test('portrait', async ({ page }) => {
    await connectMatribox(page);
    await pickCatalog(page);
    await snap(page, 'phone-dark', {});
    await snap(page, 'phone-dark-full');
    await page.getByRole('button', { name: 'Add a block…' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Add a block…' }).click();
    await snap(page, 'phone-add-types', {});
    await page.getByRole('listbox', { name: 'Add a block: type' }).getByRole('option', { name: 'DRV', exact: true }).click();
    await snap(page, 'phone-add-models', {});
  });
  for (const theme of ['dark', 'light'] as const) {
    test(`tone library, ${theme} theme`, async ({ page }) => {
      await connectMatribox(page);
      if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
      await pickCatalog(page);
      const library = await keepTones(page);
      // The Read button sits in the More menu here: the Keep button tells the editor is idle.
      await expect(library.getByRole('button', { name: 'Keep tone' })).toBeEnabled();
      await library.screenshot({ path: `${DIR}/library-phone-${theme}.png` });
    });
  }
});
