import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { mbAssignments, parseMbPreset, toHex } from '@pocket-master/core';
import { measure } from './contrast.ts';
import { blockPanel, connectMatribox, expect, expectChain, pickCatalog, test, turnKnob } from './matribox-fixtures.ts';

const loaded = (unit: { editBuffer: Uint8Array }) => parseMbPreset(unit.editBuffer);

test('a Matribox is recognised by its port and gets its own editor, usable without the catalog', async ({ page }) => {
  await connectMatribox(page);
  // None of the Pocket Master's tools.
  await expect(page.getByRole('button', { name: 'Tuner' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Load 60D/ })).toBeAttached();
  await expect(page.getByText('/Applications/Matribox II PRO.app/Contents/Frameworks/App.framework/Resources/flutter_assets/assets/alg/alg_data.json')).toBeVisible();
  await expectChain(page, 'module 0 → module 3 → module 4 → module 5 → module 10 → module 15');
  // Each module keeps its colour by index, and a tile shows the raw model id.
  await expect(page.locator('.tile.mb-drv')).toContainText('0300002a');
  // The AMP is selected: its model is unknown, so its stored values show raw.
  const amp = page.getByRole('region', { name: '3. module 4 block' });
  await expect(amp.getByText('Unknown model (0x0700001a)')).toBeVisible();
  await expect(amp.getByRole('list', { name: 'Raw values of 3. module 4' }).getByRole('listitem')).toHaveCount(15);
  await expect(page.getByRole('slider')).toHaveCount(1); // the patch volume only: parameters need the catalog
  await expect(page.getByRole('slider', { name: 'Patch volume' })).toBeVisible();

  // Adding still works by module; the models known are only the ids the chain uses.
  await page.getByRole('button', { name: 'Add a block…' }).click();
  const types = page.getByRole('listbox', { name: 'Add a block: type' });
  await expect(types.getByRole('option')).toHaveCount(16);
  await types.getByRole('option', { name: 'DRV' }).click();
  const models = page.getByRole('listbox', { name: 'Add a block: DRV model' });
  await expect(models.getByRole('option')).toHaveText(['‹ Back to block types', 'Unknown model (0x0300002a)']);
  await models.getByRole('option', { name: /Back to block types/ }).click();
  await types.getByRole('option', { name: 'WAH' }).click();
  await expect(page.getByRole('listbox', { name: 'Add a block: WAH model' }).getByRole('option', { name: 'Pick alg_data.json to list these models' })).toHaveAttribute('aria-disabled', 'true');
});

test('the chain shows as pedals; the AMP is dressed like the gear its model is based on', async ({ page }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL');
  const chain = page.getByRole('list', { name: 'Signal chain' });
  await expect(chain.getByRole('button', { name: 'Edit 3. AMP: Fake Plexi' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chain.getByRole('switch', { name: '2. DRV off' })).toBeVisible();
  const amp = page.getByRole('region', { name: '3. AMP block' });
  await expect(amp.locator('.face-amp')).toHaveAttribute('data-skin', 'marshall'); // "Imaginary Plexi 50W"
  await expect(amp.getByText('Based on Imaginary Plexi 50W')).toBeVisible();
  await expect(amp.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '30');

  // One panel: the selected block's.
  await expect(page.locator('section.editor')).toHaveCount(1);
  const drive = await blockPanel(page, 2, 'DRV');
  await expect(drive.getByText('Based on Imaginary Overdrive 808 · A mid-boost overdrive.')).toBeVisible();
  await expect(drive.locator('.face-amp')).toHaveCount(0);
  await expect(page.locator('section.editor')).toHaveCount(1);
});

test('with the picked catalog: live parameters, on/off, models and chain edits reach the unit', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const drive = await blockPanel(page, 2, 'DRV');

  // A knob turned key after key: the unit ends on the last value.
  await turnKnob(drive.getByRole('slider', { name: 'Gain' }), 16);
  await expect.poll(() => loaded(unit).chain[1]!.values[0]).toBe(16);

  await drive.getByRole('switch', { name: '2. DRV off' }).click();
  await expect.poll(() => loaded(unit).chain[1]!.on).toBe(true);
  // The tile's LED is the same switch.
  await page.getByRole('list', { name: 'Signal chain' }).getByRole('switch', { name: '2. DRV on' }).click();
  await expect.poll(() => loaded(unit).chain[1]!.on).toBe(false);

  // The block's menu lists only DRV models, under their type headings.
  await drive.getByRole('button', { name: '2. DRV model' }).click();
  const menu = page.getByRole('listbox', { name: '2. DRV model' });
  await expect(menu.getByRole('option')).toHaveCount(2);
  await expect(menu.locator('.picker-heading')).toHaveText(['Overdrive', 'Fuzz']);
  await expect(menu.getByRole('group', { name: 'Overdrive' }).getByRole('option')).toHaveText(['✓Fake DriveImaginary Overdrive 808']);
  await expect(menu.getByRole('group', { name: 'Fuzz' }).getByRole('option')).toHaveText(['Fake FuzzImaginary Fuzz Face']);
  await menu.getByRole('option', { name: /^Fake Fuzz/ }).click();
  await expect(drive.getByRole('button', { name: '2. DRV model' })).toContainText('Fake Fuzz');
  expect(loaded(unit).chain[1]!.fxid).toBe(0x03000010);
  // A module with a single type shows no heading.
  await (await blockPanel(page, 5, 'RVB')).getByRole('button', { name: '5. RVB model' }).click();
  await expect(page.getByRole('listbox', { name: '5. RVB model' }).locator('.picker-heading')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Add: the block type first, then that module's models.
  await page.getByRole('button', { name: 'Add a block…' }).click();
  const types = page.getByRole('listbox', { name: 'Add a block: type' });
  await expect(types.getByRole('option')).toHaveText(['DYN', 'DRV', 'AMP', 'CAB', 'IR', 'DLY', 'RVB', 'CLONE', 'VOL']);
  await expect(types.locator('.mb-pick-icon.mb-dly .module-icon')).toBeVisible();
  await types.getByRole('option', { name: 'DLY' }).click();
  const delays = page.getByRole('listbox', { name: 'Add a block: DLY model' });
  await expect(delays.getByRole('option')).toHaveText(['‹ Back to block types', 'Fake EchoImaginary Tape Echo']);
  await expect(delays.locator('.picker-heading')).toHaveCount(0);
  await delays.getByRole('option', { name: /^Fake Echo/ }).click();
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL → DLY');
  // The block just added is the one shown; a knob whose range is not 0..100 says it.
  const echo = page.getByRole('region', { name: '7. DLY block' });
  await expect(echo.getByText('20 … 2000')).toBeVisible();

  await page.getByRole('button', { name: 'Move block 7 earlier in the chain' }).click();
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → DLY → VOL');

  const dyn = await blockPanel(page, 1, 'DYN');
  await dyn.getByRole('button', { name: 'Remove 1. DYN from the chain' }).click();
  await expectChain(page, 'DRV → AMP → CAB → RVB → DLY → VOL');
  expect(loaded(unit).chain.map((b) => b.moduleIndex)).toEqual([3, 4, 5, 10, 9, 15]);
});

test('the add menu works from the keyboard: arrows, Enter, Escape back a step and out', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const add = page.getByRole('button', { name: 'Add a block…' });
  await expect(add).toBeEnabled(); // not while the editor is still reading
  await add.focus();
  await page.keyboard.press('Enter');
  const types = page.getByRole('listbox', { name: 'Add a block: type' });
  await expect(types).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(types.getByRole('option', { name: 'DRV' })).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  const drives = page.getByRole('listbox', { name: 'Add a block: DRV model' });
  await expect(drives).toBeFocused();
  await expect(drives.locator('.picker-heading')).toHaveText(['Overdrive', 'Fuzz']);
  // Escape returns to the types, a second Escape closes the menu on the Add tile.
  await page.keyboard.press('Escape');
  await expect(types).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(types).toHaveCount(0);
  await expect(add).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('d'); // DYN
  await page.keyboard.press('d'); // DRV
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await expect(drives.getByRole('option', { name: /^Fake Fuzz/ })).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expectChain(page, 'DYN → DRV → AMP → CAB → RVB → VOL → DRV');
  expect(loaded(unit).chain.at(-1)).toMatchObject({ moduleIndex: 3, fxid: 0x03000010 });
});

test('patch volume, footswitch and expression assignments reach the unit; tuner and tempo go as Control Changes', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const assigned = () => mbAssignments(loaded(unit));

  await turnKnob(page.getByRole('slider', { name: 'Patch volume' }), 80);
  await expect.poll(() => assigned().volume).toBe(80);

  // The chip follows the unit: it shows the preset read back after the write.
  const footswitches = page.getByRole('region', { name: 'Footswitches (stomp mode)' });
  await expect(footswitches.getByRole('group', { name: 'Footswitch A' }).getByRole('switch', { checked: true })).toHaveText(['1DYN']);
  const switchC = footswitches.getByRole('switch', { name: 'Footswitch C toggles 2. DRV' });
  await switchC.click();
  await expect(switchC).toHaveAttribute('aria-checked', 'true');
  expect(assigned().footswitches[2]).toContain(0);
  await switchC.click();
  await expect(switchC).toHaveAttribute('aria-checked', 'false');
  expect(assigned().footswitches[2]).not.toContain(0);

  // Expression: folded away until asked for; entries in their pedal modes.
  const expression = page.getByRole('region', { name: 'Expression pedal' });
  await expect(expression.getByText('1 of 9 in use')).toBeVisible();
  await expect(expression.getByRole('combobox', { name: 'Block of expression entry 4' })).toBeHidden();
  await expression.getByText('Expression pedal').click();
  await expect(expression.getByRole('group', { name: 'EXP 1 · mode B' }).getByRole('combobox', { name: /^Block of expression entry/ })).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Block of expression entry 4' }).selectOption({ label: '2. DRV Fake Drive' });
  await page.getByRole('combobox', { name: 'Parameter of expression entry 4' }).selectOption({ label: 'Tone' });
  await page.getByRole('spinbutton', { name: 'Minimum of expression entry 4' }).fill('10');
  await page.getByRole('spinbutton', { name: 'Maximum of expression entry 4' }).fill('90');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('combobox', { name: 'Block of expression entry 4' }) })
    .getByRole('button', { name: 'Apply' })
    .click();
  await expect.poll(() => assigned().expression[3]).toEqual({ entry: 3, slot: 0, paramId: 1, min: 10, max: 90 });

  await page.getByRole('switch', { name: 'Tuner' }).click();
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
  await expect(page.getByText('Unknown model (0x0700001a)')).toBeVisible();
});

test('the preset list groups the banks, filters and marks the loaded preset', async ({ page }) => {
  await connectMatribox(page);
  const presets = page.getByRole('complementary', { name: 'Presets' });
  await expect(presets.getByRole('list', { name: 'Bank 17' }).getByRole('button')).toHaveCount(4);
  await expect(presets.getByRole('button', { name: /Load 17C/ })).toHaveAttribute('aria-current', 'true');
  await presets.getByRole('searchbox', { name: 'Filter' }).fill('drive ad');
  await expect(presets.getByRole('list', { name: /^Bank/ })).toHaveCount(1);
  await expect(presets.getByRole('button', { name: /^Load/ })).toHaveText(['17CDrive AD']);
});

test('loading a preset asks first over live edits', async ({ page, unit }) => {
  await connectMatribox(page);
  await page.getByRole('list', { name: 'Signal chain' }).getByRole('switch', { name: '2. module 3 off' }).click();
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
  await expect(page.getByRole('button', { name: /Load 2B “My Tone”/ })).toBeAttached();
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('pocket-master-editor.matribox-backups.v1') ?? '[]'));
  expect(kept.map((b: { label: string }) => b.label)).toEqual(['2B']);
  // What 2B stored (empty here), not the loaded preset: the unit reads only a loaded slot truly.
  expect(kept[0].name).toBe('');
  expect(unit.current).toBe(5);
  await expect(page.getByRole('region', { name: 'Matribox backups' })).toContainText('2B');
});

test('back up all presets: every slot read once loaded, one file downloaded, the loaded preset loaded again', async ({ page, unit }) => {
  test.slow(); // 240 selects and reads: over 20 s on a busy CI runner
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
  test.slow(); // a backup of all 240 presets first: over 20 s on a busy CI runner
  await connectMatribox(page);
  const drive = toHex(unit.editBuffer).replaceAll(' ', '');
  const file = {
    format: 'opensonicx-matribox-backup',
    version: 1,
    device: 'Sonicake Matribox II Pro',
    createdAt: '2026-11-24T12:00:00.000Z',
    presets: [
      { index: 0, label: '1A', name: 'Drive AD', preset: drive },
      { index: 1, label: '1B', name: 'Drive AD', preset: drive },
    ],
  };
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
  await expect(page.getByRole('button', { name: /Load 1B “Drive AD”/ })).toBeAttached();
});

test('restore all refuses a file that is not a backup-all file', async ({ page }) => {
  await connectMatribox(page);
  await page.getByLabel('Choose a backup-all file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"pocket-master-backup"}') });
  await expect(page.getByRole('region', { name: 'All presets' }).getByRole('alert')).toContainText('not a Matribox backup-all file');
});

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in the Matribox editor, without and with the catalog (${theme} theme)`, async ({ page }) => {
    const violations = async () =>
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    await connectMatribox(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    expect(await violations()).toEqual([]);
    await pickCatalog(page);
    await page.getByText('Expression pedal').click();
    expect(await violations()).toEqual([]);
    // The menus open: a block's model menu, then both steps of the add menu.
    // The DRV (two types, so headings) switched on: an off block's dimmed labels are inactive controls.
    const drive = await blockPanel(page, 2, 'DRV');
    await drive.getByRole('switch', { name: '2. DRV off' }).click();
    await drive.getByRole('button', { name: '2. DRV model' }).click();
    await expect(page.getByRole('listbox', { name: '2. DRV model' })).toBeVisible();
    expect(await violations()).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add a block…' }).click();
    await expect(page.getByRole('listbox', { name: 'Add a block: type' })).toBeVisible();
    expect(await violations()).toEqual([]);
    await page.getByRole('listbox', { name: 'Add a block: type' }).getByRole('option', { name: 'DRV', exact: true }).click();
    await expect(page.getByRole('listbox', { name: 'Add a block: DRV model' })).toBeVisible();
    expect(await violations()).toEqual([]);
  });

  // axe leaves text over gradients and the amp's faceplate unmeasured; those are measured from pixels.
  test(`text over gradients is readable in the Matribox editor (${theme} theme)`, async ({ page }) => {
    test.setTimeout(180_000);
    await connectMatribox(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await pickCatalog(page);
    const failures: string[] = [];
    for (const position of [3, 2]) {
      if (position === 2) await blockPanel(page, 2, 'DRV');
      // The editor's own panels; the preset list is the Pocket Master's, measured by a11y.spec.ts.
      const { incomplete } = await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze();
      for (const node of incomplete.flatMap((v) => v.nodes)) {
        if (/non-text/.test(node.any[0]?.message ?? '')) continue;
        const r = await measure(page, page.locator(node.target.join(' ')).first());
        if (r && r.ratio < r.required) failures.push(`${node.target.join(' ')} "${r.text}": ${r.ratio.toFixed(2)} < ${r.required}`);
      }
    }
    expect(failures).toEqual([]);
  });
}
