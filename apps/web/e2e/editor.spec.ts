import { test, expect, connect } from './fixtures.ts';
import type { Page } from '@playwright/test';

const amp = (page: Page) => page.locator('section.block-amp');

async function liveEdit(page: Page) {
  await page.getByRole('switch', { name: 'Live edit' }).click();
  await expect(page.getByText(/Live edit is on/)).toBeVisible();
}

async function pickAmp(page: Page, model: string) {
  await amp(page).locator('.picker-button').click();
  await page.getByRole('option', { name: new RegExp(`^${model}\\b`) }).click();
}

test('reads the loaded preset, its chain and the slot names', async ({ page, pedal }) => {
  await connect(page, pedal);
  await expect(page.getByRole('heading', { name: /P09\s*IRON-LEAD/ })).toBeVisible();
  await expect(amp(page).getByText('Brit 800')).toBeVisible();
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'marshall');
  await expect(page.getByRole('region', { name: 'Pedal slots' }).getByText('Randall SA')).toBeVisible();
});

test('controls stay read-only until live edit is on', async ({ page, pedal }) => {
  await connect(page, pedal);
  const gain = amp(page).getByRole('slider', { name: /gain/i });
  await expect(gain).toHaveAttribute('aria-disabled', 'true');
  await liveEdit(page);
  await expect(gain).toHaveAttribute('aria-disabled', 'false');
});

test('live edit sends a knob turn and a model change to the pedal', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  const gain = amp(page).getByRole('slider', { name: /gain/i });
  const before = Number(await gain.getAttribute('aria-valuenow'));
  await gain.focus();
  await page.keyboard.press('ArrowUp');
  await expect(gain).toHaveAttribute('aria-valuenow', String(before + 1));
  await expect.poll(() => pedal.pedal.received).toContain('edit 48');

  await pickAmp(page, 'Calif DualM');
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'mesa');
  await expect.poll(() => pedal.pedal.received).toContain('edit 47');
});

test('revert reloads the preset as it was first read', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await expect(amp(page).getByText('Calif DualM')).toBeVisible();
  await page.getByRole('button', { name: 'Revert' }).click();
  await expect(amp(page).getByText('Brit 800')).toBeVisible();
  expect(pedal.pedal.received).toContain('select 8');
});

test('loading another preset asks before discarding unsaved changes', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await page.getByRole('button', { name: /Load P10/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard the changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: /P09/ })).toBeVisible();
  expect(pedal.pedal.current).toBe(8);

  await page.getByRole('button', { name: /Load P10/ }).click();
  await page.getByRole('button', { name: 'Discard and load' }).click();
  await expect(page.getByRole('heading', { name: /P10\s*THR-CLEAN/ })).toBeVisible();
  expect(pedal.pedal.current).toBe(9);
});

test('saves to the loaded slot after backing it up, and checks it on the pedal', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to a preset slot' });
  await dialog.getByLabel('Name').fill('E2E RECT');
  await dialog.getByRole('button', { name: 'Back up and save to P09' }).click();
  await expect(page.getByText('Saved to P09 as “E2E RECT” and checked on the pedal.')).toBeVisible();
  expect(pedal.pedal.names[8]).toBe('E2E RECT');
  expect(pedal.pedal.received).toContain('save 8 E2E RECT');
});

test('a comment on a captured profile shows next to it in the AMP menu', async ({ page, pedal }) => {
  await connect(page, pedal);
  const slots = page.getByRole('region', { name: 'Pedal slots' });
  await slots.getByRole('button', { name: 'Comment' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Comment for Randall SA' });
  await dialog.getByRole('textbox').fill('Randall Satan, high gain');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(slots.getByText('Randall Satan, high gain')).toBeVisible();
  await liveEdit(page);
  await amp(page).locator('.picker-button').click();
  await expect(page.getByRole('option', { name: /Randall SA.*Randall Satan, high gain/ })).toBeVisible();
});

test('a save backs up the slot first, and that backup puts the slot back as it was', async ({ page, pedal }) => {
  await connect(page, pedal);
  const original = { name: pedal.pedal.names[8], bytes: Array.from(pedal.pedal.slots[8]!) };
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await page.getByRole('button', { name: 'Save…' }).click();
  const save = page.getByRole('dialog', { name: 'Save to a preset slot' });
  await save.getByLabel('Name').fill('E2E RECT');
  await save.getByRole('button', { name: 'Back up and save to P09' }).click();
  await expect(page.getByText(/Saved to P09/)).toBeVisible();
  expect(Array.from(pedal.pedal.slots[8]!)).not.toEqual(original.bytes);
  await save.getByRole('button', { name: 'Done' }).click();

  // The backup was taken before the save: it holds the old name and the old sound.
  const backups = page.getByRole('region', { name: 'Backups' });
  await backups.getByText(`P09 “${original.name}”`).click();
  await backups.getByRole('button', { name: 'Restore to P09' }).click();
  await page.getByRole('button', { name: 'Back up and restore' }).click();
  await expect(page.getByText(`P09 is back to “${original.name}”, checked on the pedal.`)).toBeVisible();
  expect(pedal.pedal.names[8]).toBe(original.name);
  expect(Array.from(pedal.pedal.slots[8]!)).toEqual(original.bytes);
});

test('undo and redo step through live edits, a knob turn counting as one step', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  const gain = amp(page).getByRole('slider', { name: /gain/i });
  const before = Number(await gain.getAttribute('aria-valuenow'));
  await gain.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await expect(gain).toHaveAttribute('aria-valuenow', String(before + 3));
  await pickAmp(page, 'Calif DualM');
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'mesa');

  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await undo.click();
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'marshall');
  await expect(gain).toHaveAttribute('aria-valuenow', String(before + 3));
  await undo.click();
  await expect(gain).toHaveAttribute('aria-valuenow', String(before));
  await expect(undo).toBeDisabled();
  // The pedal holds what the screen shows.
  await expect.poll(() => pedal.pedal.editBuffer.join()).toBe(pedal.pedal.slots[8]!.join());

  await redo.click();
  await expect(gain).toHaveAttribute('aria-valuenow', String(before + 3));
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'mesa');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'marshall');
});

test('importing a preset file first shows what it changes from the loaded preset', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await page.getByText('Import preset').locator('input[type=file]').setInputFiles(new URL('../../../packages/core/test/fixtures/preset-files/v1-iron-lead.json', import.meta.url).pathname);
  const dialog = page.getByRole('dialog', { name: 'Import a preset' });
  const changes = dialog.getByRole('region', { name: 'What changes from the loaded preset' });
  await expect(changes.getByRole('listitem').filter({ hasText: 'AMP Model' })).toContainText('Calif DualM → Brit 800');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(amp(page).getByText('Calif DualM')).toBeVisible();
});

test('the save dialog suggests the name of the slot it saves to, every time it opens', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await page.getByRole('button', { name: 'Save…' }).click();
  const save = page.getByRole('dialog', { name: 'Save to a preset slot' });
  await expect(save.getByLabel('Name')).toHaveValue('IRON-LEAD');
  await save.getByLabel('Name').fill('E2E RECT');
  await save.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /Load P10/ }).click();
  await page.getByRole('button', { name: 'Discard and load' }).click();
  await expect(page.getByRole('heading', { name: /P10\s*THR-CLEAN/ })).toBeVisible();
  await pickAmp(page, 'Calif DualM');
  await page.getByRole('button', { name: 'Save…' }).click();
  await expect(save.getByLabel('Name')).toHaveValue('THR-CLEAN');
});

test('after a save the preset is no longer modified: loading another one does not ask', async ({ page, pedal }) => {
  await connect(page, pedal);
  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await page.getByRole('button', { name: 'Read' }).click(); // the pedal now says "modified" too
  await page.getByRole('button', { name: 'Save…' }).click();
  const save = page.getByRole('dialog', { name: 'Save to a preset slot' });
  await save.getByRole('button', { name: 'Back up and save to P09' }).click();
  await save.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Revert' })).toBeDisabled();
  await page.getByRole('button', { name: /Load P10/ }).click();
  await expect(page.getByRole('heading', { name: /P10\s*THR-CLEAN/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Discard the changes?' })).toBeHidden();
});

test('an exported preset goes into the library, and loads from there with its comparison', async ({ page, pedal }) => {
  await connect(page, pedal);
  const library = page.getByRole('region', { name: 'Preset library' });
  await expect(library.getByText(/Presets you export or import/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export preset' }).click();
  await download;
  await expect(library.getByText('IRON-LEAD')).toBeVisible();

  await liveEdit(page);
  await pickAmp(page, 'Calif DualM');
  await library.getByRole('button', { name: 'Load IRON-LEAD' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a preset' });
  await expect(dialog.getByRole('listitem').filter({ hasText: 'AMP Model' })).toContainText('Calif DualM → Brit 800');
  await dialog.getByRole('button', { name: 'Load into the pedal' }).click();
  await expect(dialog.getByText(/is loaded into the edit buffer/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(amp(page).getByText('Brit 800')).toBeVisible();

  await library.getByRole('button', { name: 'Remove IRON-LEAD from the library' }).click();
  await expect(library.getByText('IRON-LEAD')).toBeHidden();
});
