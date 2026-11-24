import AxeBuilder from '@axe-core/playwright';
import { parseMbPreset } from '@pocket-master/core';
import { connectMatribox, expect, pickCatalog, test } from './matribox-fixtures.ts';

const loaded = (unit: { editBuffer: Uint8Array }) => parseMbPreset(unit.editBuffer);

test('a Matribox is recognised by its port and gets its own editor, usable without the catalog', async ({ page }) => {
  await connectMatribox(page);
  // None of the Pocket Master's tools.
  await expect(page.getByRole('button', { name: 'Tuner' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Load 60D/ })).toBeVisible();
  await expect(page.getByText('/Applications/Matribox II PRO.app/Contents/Frameworks/App.framework/Resources/flutter_assets/assets/alg/alg_data.json')).toBeVisible();
  await expect(page.getByText('Chain: module 0 → module 3 → module 4 → module 5 → module 10 → module 15')).toBeVisible();
  await expect(page.getByText('Unknown model (0x0300002a)')).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Add a block…' })).toHaveCount(0);
});

test('with the picked catalog: models, gear, live parameters, on/off and chain edits reach the unit', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await expect(page.getByText('Chain: DYN → DRV → AMP → CAB → RVB → VOL')).toBeVisible();
  await expect(page.getByText('Based on Imaginary Overdrive 808')).toBeVisible();

  const gain = page.getByRole('slider', { name: 'DRV Gain' });
  await gain.fill('16');
  await expect.poll(() => loaded(unit).chain[1]!.values[0]).toBe(16);

  const drive = page.getByRole('listitem', { name: /^2\. DRV/ });
  await drive.getByRole('checkbox').check();
  await expect.poll(() => loaded(unit).chain[1]!.on).toBe(true);

  await drive.getByRole('combobox', { name: 'Change model…' }).selectOption({ label: 'Fake Fuzz · Imaginary Fuzz Face' });
  await expect(page.getByRole('listitem', { name: '2. DRV Fake Fuzz' })).toBeVisible();
  expect(loaded(unit).chain[1]!.fxid).toBe(0x03000010);

  await page.getByRole('combobox', { name: 'Add a block…' }).selectOption({ label: 'Fake Echo · Imaginary Tape Echo' });
  await expect(page.getByText('Chain: DYN → DRV → AMP → CAB → RVB → VOL → DLY')).toBeVisible();

  await page.getByRole('button', { name: 'Move block 7 earlier in the chain' }).click();
  await expect(page.getByText('Chain: DYN → DRV → AMP → CAB → RVB → DLY → VOL')).toBeVisible();

  await page.getByRole('listitem', { name: /^1\. DYN/ }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Chain: DRV → AMP → CAB → RVB → DLY → VOL')).toBeVisible();
  expect(loaded(unit).chain.map((b) => b.moduleIndex)).toEqual([3, 4, 5, 10, 9, 15]);
});

test('the catalog stays in this browser across visits', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await connectMatribox(page);
  await expect(page.getByText('Model catalog: 10 models.')).toBeVisible();
  await page.getByRole('button', { name: 'Forget' }).click();
  await expect(page.getByText('Unknown model (0x0300002a)')).toBeVisible();
});

test('loading a preset asks first over live edits', async ({ page, unit }) => {
  await connectMatribox(page);
  await page.getByRole('listitem', { name: /^2\. module 3/ }).getByRole('checkbox').check();
  await page.getByRole('button', { name: /Load 1A/ }).click();
  await page.getByRole('button', { name: 'Discard and load' }).click();
  await expect.poll(() => unit.current).toBe(0);
  await expect(page.getByRole('heading', { name: /^1A/ })).toBeVisible();
});

test('saving needs an explicit confirmation, backs the slot up first and is checked on the unit', async ({ page, unit }) => {
  await connectMatribox(page);
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to the Matribox' });
  await dialog.getByRole('combobox', { name: 'Slot' }).selectOption({ index: 5 });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('My Tone');
  const submit = dialog.getByRole('button', { name: 'Save to 2B' });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Replace 2B/ }).check();
  await submit.click();
  await expect(dialog.getByText('Saved to 2B “My Tone”.')).toBeVisible();
  expect(parseMbPreset(unit.stored(5)!).name).toBe('My Tone');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /Load 2B “My Tone”/ })).toBeVisible();
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('pocket-master-editor.matribox-backups.v1') ?? '[]'));
  expect(kept.map((b: { label: string }) => b.label)).toEqual(['2B']);
  await expect(page.getByRole('region', { name: 'Matribox backups' })).toContainText('2B');
});

test('no WCAG A/AA violations in the Matribox editor, without and with the catalog', async ({ page }) => {
  const violations = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  await connectMatribox(page);
  expect(await violations()).toEqual([]);
  await pickCatalog(page);
  expect(await violations()).toEqual([]);
  if (process.env.MB_SCREENSHOT) await page.screenshot({ path: process.env.MB_SCREENSHOT, fullPage: true });
});
