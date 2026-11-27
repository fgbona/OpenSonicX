/**
 * Screenshots of the workstation look for the owner's review, only when WS_SHOTS names a folder:
 * `WS_SHOTS=/tmp/shots npx playwright test e2e/workstation-shots.spec.ts`. Simulated unit only.
 */
import { blockPanel, connectMatribox, test } from './matribox-fixtures.ts';

const dir = process.env.WS_SHOTS;

for (const theme of ['dark', 'light'] as const) {
  test(`Matribox workstation, ${theme}`, async ({ page }) => {
    test.skip(!dir, 'WS_SHOTS not set');
    await page.addInitScript((t) => localStorage.setItem('pocket-master-editor.theme', t), theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await connectMatribox(page);
    const drive = await blockPanel(page, 2, 'DRV');
    await drive.getByRole('slider', { name: 'Gain' }).focus();
    await page.keyboard.press('ArrowUp');
    await page.screenshot({ path: `${dir}/matribox-${theme}.png` });
    await page.getByRole('button', { name: 'Type a value for “Gain”' }).first().click();
    await page.locator('section.editor').screenshot({ path: `${dir}/block-typing-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save…' }).click();
    await page.getByRole('dialog').screenshot({ path: `${dir}/save-${theme}.png` });
  });
}

test('Matribox workstation, phone', async ({ page }) => {
  test.skip(!dir, 'WS_SHOTS not set');
  await page.setViewportSize({ width: 390, height: 844 });
  await connectMatribox(page);
  await page.screenshot({ path: `${dir}/matribox-phone.png`, fullPage: true });
});
