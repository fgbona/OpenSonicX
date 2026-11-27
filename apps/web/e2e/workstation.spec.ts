/**
 * The workstation look (docs/design/workstation-ui.md): knob drag, wheel, typing and reset, and the
 * edited (dirty) and sync states, against the simulated Matribox and Pocket Master; no hardware.
 */
import type { Page } from '@playwright/test';
import { parseMbPreset } from '@pocket-master/core';
import { blockPanel, connectMatribox, expect, test } from './matribox-fixtures.ts';
import { connect, test as pmTest, expect as pmExpect } from './fixtures.ts';

const ampGain = (page: Page) => page.getByRole('region', { name: '3. AMP block' }).getByRole('slider', { name: 'Gain' });
/** The edit buffer's AMP (3rd block) gain and the stored one of the loaded slot. */
const bufferGain = (unit: { editBuffer: Uint8Array }) => parseMbPreset(unit.editBuffer).chain[2]!.values[0];
const storedGain = (unit: { current: number; stored(i: number): Uint8Array | undefined }) => parseMbPreset(unit.stored(unit.current)!).chain[2]!.values[0];
const sync = (page: Page) => page.locator('.ws-sync');

test('a knob turns by vertical drag and by the wheel, and the unit follows', async ({ page, unit }) => {
  await connectMatribox(page);
  const gain = ampGain(page);
  await expect(gain).toHaveAttribute('aria-valuenow', '30');
  // A knob ignores the pointer while the editor is busy (the connect reads).
  await expect(gain).toHaveAttribute('aria-disabled', 'false');
  await gain.scrollIntoViewIfNeeded();
  const box = (await gain.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // 220 px is the whole range (0..100): 44 px up is +20.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 22, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 44, { steps: 4 });
  await page.mouse.up();
  await expect(gain).toHaveAttribute('aria-valuenow', '50');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.mouse.wheel(0, -100);
  await expect(gain).toHaveAttribute('aria-valuenow', '51');
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, 100);
  await expect(gain).toHaveAttribute('aria-valuenow', '49');
  await expect.poll(() => bufferGain(unit)).toBe(49);
});

test('a knob takes a typed value, Escape cancels, and a double-click resets the default', async ({ page, unit }) => {
  await connectMatribox(page);
  const amp = page.getByRole('region', { name: '3. AMP block' });
  const gain = ampGain(page);

  await amp.getByRole('button', { name: 'Type a value for “Gain”' }).click();
  const field = amp.getByRole('textbox', { name: 'Gain value' });
  await expect(field).toBeFocused();
  await field.fill('72');
  await field.press('Enter');
  await expect(gain).toHaveAttribute('aria-valuenow', '72');
  await expect.poll(() => bufferGain(unit)).toBe(72);

  // Out of range is clamped; a value with a unit still reads as its number.
  await amp.getByRole('button', { name: 'Type a value for “Gain”' }).click();
  await amp.getByRole('textbox', { name: 'Gain value' }).fill('140 %');
  await amp.getByRole('textbox', { name: 'Gain value' }).press('Enter');
  await expect(gain).toHaveAttribute('aria-valuenow', '100');

  await amp.getByRole('button', { name: 'Type a value for “Gain”' }).click();
  await amp.getByRole('textbox', { name: 'Gain value' }).fill('5');
  await amp.getByRole('textbox', { name: 'Gain value' }).press('Escape');
  await expect(amp.getByRole('textbox', { name: 'Gain value' })).toHaveCount(0);
  await expect(gain).toHaveAttribute('aria-valuenow', '100');

  // Enter on the focused knob opens the field too.
  await gain.focus();
  await gain.press('Enter');
  await expect(amp.getByRole('textbox', { name: 'Gain value' })).toBeFocused();
  await amp.getByRole('textbox', { name: 'Gain value' }).press('Escape');

  await gain.dblclick();
  await expect(gain).toHaveAttribute('aria-valuenow', '30'); // the catalog's default
  await expect.poll(() => bufferGain(unit)).toBe(30);
});

test('an edit marks the preset and the block as not stored; saving brings them back in sync', async ({ page, unit }) => {
  await connectMatribox(page);
  const chain = page.getByRole('list', { name: 'Signal chain' });
  const edited = chain.getByRole('img', { name: 'Edited, not stored' });
  await expect(sync(page)).toHaveText('In sync with the pedal');
  await expect(edited).toHaveCount(0);

  const drive = await blockPanel(page, 2, 'DRV');
  await drive.getByRole('slider', { name: 'Gain' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(sync(page)).toHaveText('Edited · not stored in 17C');
  await expect(sync(page)).toHaveAttribute('data-sync', 'dirty');
  await expect(edited).toHaveCount(1);
  await expect(chain.locator('.tile-dirty')).toHaveClass(/mb-drv/);
  // The loaded preset in the list shows it too.
  await expect(page.locator('.sidebar-item.is-current .ws-dirty-dot')).toBeVisible();

  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to the Matribox' });
  await dialog.getByRole('checkbox', { name: /Replace 17C/ }).check();
  await dialog.getByRole('button', { name: 'Save to 17C' }).click();
  await expect(dialog.getByText(/Saved to 17C/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(sync(page)).toHaveText('In sync with the pedal');
  await expect(edited).toHaveCount(0);
  expect(storedGain(unit)).toBe(30); // the AMP was not touched
});

test('the save dialog names a preset by its bank role', async ({ page }) => {
  await connectMatribox(page);
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to the Matribox' });
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await name.fill('MTL');
  await dialog.getByRole('button', { name: 'Set as the RHY preset of the bank' }).click();
  await expect(name).toHaveValue('MTL-RHY');
  await dialog.getByRole('button', { name: 'Set as the LEAD preset of the bank' }).click();
  await expect(name).toHaveValue('MTL-LEAD');
  await expect(dialog.getByRole('button', { name: 'Set as the LEAD preset of the bank' })).toHaveAttribute('aria-pressed', 'true');
});

test('the rack nav jumps to every section', async ({ page }) => {
  await connectMatribox(page);
  const nav = page.getByRole('navigation', { name: 'Editor sections' });
  for (const [link, id] of [
    ['Controls', 'ws-controls'],
    ['Assistant', 'ws-assistant'],
    ['Library', 'ws-library'],
    ['Clones & IRs', 'ws-clones'],
    ['Backups', 'ws-backups'],
    ['Chain', 'ws-chain'],
  ] as const) {
    await nav.getByRole('link', { name: link }).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
});

pmTest('Pocket Master: a typed value and the edited state', async ({ page, pedal }) => {
  await connect(page, pedal);
  const amp = page.locator('section.block-amp');
  await pmExpect(sync(page)).toHaveText('In sync with the pedal');
  const gain = amp.getByRole('slider', { name: /gain/i });
  const before = Number(await gain.getAttribute('aria-valuenow'));
  const typed = String(before >= 50 ? before - 5 : before + 5);
  await amp.getByRole('button', { name: /^Type a value for “gain”/i }).click();
  await amp.getByRole('textbox', { name: /gain value/i }).fill(typed);
  await amp.getByRole('textbox', { name: /gain value/i }).press('Enter');
  await pmExpect(gain).toHaveAttribute('aria-valuenow', typed);
  await pmExpect(sync(page)).toHaveText('Edited · not stored in P09');
  await pmExpect(page.getByRole('list', { name: 'Signal chain' }).getByRole('img', { name: 'Edited, not stored' })).toHaveCount(1);
});
