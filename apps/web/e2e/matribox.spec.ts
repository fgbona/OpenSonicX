import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { mbAssignments, parseMbPreset, toHex } from '@pocket-master/core';
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
  await expect(page.getByRole('slider')).toHaveCount(1); // the patch volume only: parameters need the catalog
  await expect(page.getByRole('slider', { name: 'Patch volume' })).toBeVisible();
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

test('patch volume, footswitch and expression assignments reach the unit; tuner and tempo go as Control Changes', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const assigned = () => mbAssignments(loaded(unit));

  await page.getByRole('slider', { name: 'Patch volume' }).fill('80');
  await expect.poll(() => assigned().volume).toBe(80);

  // The box follows the unit: it shows the preset read back after the write.
  const switchC = page.getByRole('checkbox', { name: 'Footswitch C toggles 2. DRV' });
  await switchC.click();
  await expect(switchC).toBeChecked();
  expect(assigned().footswitches[2]).toContain(0);
  await switchC.click();
  await expect(switchC).not.toBeChecked();
  expect(assigned().footswitches[2]).not.toContain(0);

  await page.getByRole('combobox', { name: 'Block of expression entry 4' }).selectOption({ label: '2. DRV Fake Drive' });
  await page.getByRole('combobox', { name: 'Parameter of expression entry 4' }).selectOption({ label: 'Tone' });
  await page.getByRole('spinbutton', { name: 'Minimum of expression entry 4' }).fill('10');
  await page.getByRole('spinbutton', { name: 'Maximum of expression entry 4' }).fill('90');
  await page.getByRole('listitem').filter({ has: page.getByRole('combobox', { name: 'Block of expression entry 4' }) }).getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => assigned().expression[3]).toEqual({ entry: 3, slot: 0, paramId: 1, min: 10, max: 90 });

  await page.getByRole('checkbox', { name: 'Tuner' }).check();
  await page.getByRole('button', { name: 'Tap tempo' }).click();
  await page.getByRole('spinbutton', { name: 'BPM' }).fill('140');
  await page.getByRole('button', { name: 'Set BPM' }).click();
  await expect.poll(() => unit.controls).toEqual(['b03a7f', 'b0467f', 'b04401', 'b0450c']);
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
  // What 2B stored (empty here), not the loaded preset: the unit reads only a loaded slot truly.
  expect(kept[0].name).toBe('');
  expect(unit.current).toBe(5);
  await expect(page.getByRole('region', { name: 'Matribox backups' })).toContainText('2B');
});

test('back up all presets: every slot read once loaded, one file downloaded, the loaded preset loaded again', async ({ page, unit }) => {
  await connectMatribox(page);
  const all = page.getByRole('region', { name: 'All presets' });
  const download = page.waitForEvent('download');
  await all.getByRole('button', { name: 'Back up all presets' }).click();
  const file = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(file.format).toBe('opensonicx-matribox-backup');
  expect(file.presets).toHaveLength(240);
  expect(file.presets[66].name).toBe('Drive AD');
  expect(file.presets[0].name).toBe('');
  await expect(all.getByText('240 presets backed up and downloaded.')).toBeVisible();
  expect(unit.current).toBe(66);
});

test('restore all asks for an explicit confirmation, backs everything up first and writes each preset', async ({ page, unit }) => {
  await connectMatribox(page);
  const drive = toHex(unit.editBuffer).replaceAll(' ', '');
  const file = { format: 'opensonicx-matribox-backup', version: 1, device: 'Sonicake Matribox II Pro', createdAt: '2026-11-24T12:00:00.000Z',
    presets: [{ index: 0, label: '1A', name: 'Drive AD', preset: drive }, { index: 1, label: '1B', name: 'Drive AD', preset: drive }] };
  await page.getByLabel('Choose a backup-all file').setInputFiles({ name: 'all.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  const dialog = page.getByRole('dialog', { name: 'Restore 2 presets' });
  await expect(dialog.getByText('This overwrites 2 of the 240 presets on the Matribox')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /First back up all 240 presets/ })).toBeChecked();
  const submit = dialog.getByRole('button', { name: 'Overwrite 2 presets' });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I understand: overwrite 2 presets' }).check();
  const download = page.waitForEvent('download');
  await submit.click();
  expect(JSON.parse(readFileSync(await (await download).path(), 'utf8')).presets).toHaveLength(240);
  await expect(dialog.getByText('2 presets restored, each checked on the Matribox.')).toBeVisible();
  expect(unit.presetWrites.map((w) => w[0])).toEqual([0, 1]);
  expect(unit.current).toBe(66);
  await expect(page.getByRole('button', { name: /Load 1B “Drive AD”/ })).toBeVisible();
});

test('restore all refuses a file that is not a backup-all file', async ({ page }) => {
  await connectMatribox(page);
  await page.getByLabel('Choose a backup-all file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"pocket-master-backup"}') });
  await expect(page.getByRole('region', { name: 'All presets' }).getByRole('alert')).toContainText('not a Matribox backup-all file');
});

test('no WCAG A/AA violations in the Matribox editor, without and with the catalog', async ({ page }) => {
  const violations = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  await connectMatribox(page);
  expect(await violations()).toEqual([]);
  await pickCatalog(page);
  expect(await violations()).toEqual([]);
  if (process.env.MB_SCREENSHOT) await page.screenshot({ path: process.env.MB_SCREENSHOT, fullPage: true });
});
