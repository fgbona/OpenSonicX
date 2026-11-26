/**
 * The Matribox editor shows the chain's estimated DSP load under the chain, warns near and past the
 * limit, and shows the unit's own "System overloaded" notice (the simulated unit sends it like the
 * unit, with every block switched off).
 */
import type { Page } from '@playwright/test';
import { connectMatribox, expect, expectChain, test } from './matribox-fixtures.ts';

/** Adds a block of each type, with the type's first model, from the add tile's two-step menu. */
async function addBlocks(page: Page, types: readonly string[]) {
  const add = page.getByRole('button', { name: 'Add a block…' });
  for (const type of types) {
    await expect(add).toBeEnabled();
    await add.click();
    await page.getByRole('listbox', { name: 'Add a block: type' }).getByRole('option', { name: type, exact: true }).click();
    await page
      .getByRole('listbox', { name: `Add a block: ${type} model` })
      .getByRole('option')
      .nth(1)
      .click();
  }
}

test('the DSP load estimate warns near and past the limit, and the unit overload notice shows', async ({ page, unit }) => {
  unit.cpuOverload = true;
  await connectMatribox(page);
  const load = page.locator('.mb-dsp-load');
  await expect(load).toHaveText('Estimated DSP load: 58%'); // "Drive AD": gate, drive, amp, cab, reverb, volume
  await expect(page.locator('.mb-dsp-warning')).toHaveCount(0);

  await addBlocks(page, ['FREQ', 'DLY', 'MOD']);
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL → FREQ → DLY → MOD');
  await expect(load).toHaveText('Estimated DSP load: 87%');
  await expect(load.locator('.mb-dsp-fill')).toHaveAttribute('style', /width: 87%/);
  await expect(page.getByRole('status').filter({ hasText: 'Close to the limit' })).toBeVisible();
  const alert = page.getByRole('alert').filter({ hasText: 'The pedal reported “System overloaded”' });
  await expect(alert).toHaveCount(0);

  await addBlocks(page, ['RVB']);
  await expect(load).toHaveText('Estimated DSP load: over the limit'); // 104%: never shown past 100
  await expect(load.locator('.mb-dsp-fill')).toHaveAttribute('style', /width: 100%/);
  await expect(page.getByRole('status').filter({ hasText: 'Likely too heavy for the pedal' })).toBeVisible();
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Close' }).click();
  await expect(alert).toHaveCount(0);
});
