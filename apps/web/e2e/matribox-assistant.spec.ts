import type { Page, Route } from '@playwright/test';
import { parseMbPreset } from '@pocket-master/core';
import { CATALOG_FILE, connectMatribox, expect, pickCatalog, test } from './matribox-fixtures.ts';

// Groq is simulated: every call is answered here, so nothing leaves the machine.
type Reply = { body: unknown };
const call = (name: string, args: unknown): Reply => ({ body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'g1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] } });
const say = (text: string): Reply => ({ body: { choices: [{ message: { role: 'assistant', content: text } }] } });

async function fakeGroq(page: Page, replies: Reply[]) {
  const requests: { messages: { role: string; content: string | null }[] }[] = [];
  await page.route('https://api.groq.com/**', async (route: Route) => {
    if (route.request().url().endsWith('/models')) return route.fulfill({ json: { data: [] } });
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: (replies.shift() ?? say('(no more scripted replies)')).body });
  });
  return requests;
}

const panel = (page: Page) => page.getByRole('region', { name: 'Tone assistant' });
const chain = (page: Page, text: string) => expect(page.getByText(`Chain: ${text}`, { exact: true })).toBeVisible();
const loaded = (unit: { editBuffer: Uint8Array }) => parseMbPreset(unit.editBuffer);

async function openChat(page: Page) {
  const setup = panel(page).getByRole('region', { name: 'Groq key' });
  await setup.getByLabel('Groq API key').fill('fake-groq-key-e2e-0000');
  await setup.getByRole('button', { name: 'Save key' }).click();
  await expect(panel(page).getByRole('button', { name: 'Keys' })).toBeVisible();
}

async function ask(page: Page, text: string) {
  await panel(page).getByRole('textbox', { name: 'Message to the tone assistant' }).fill(text);
  await panel(page).getByRole('button', { name: 'Send' }).click();
}

test('without the catalog the assistant explains what it needs', async ({ page }) => {
  await connectMatribox(page);
  await expect(panel(page).getByText(/only the model catalog says: choose your alg_data.json/)).toBeVisible();
  await expect(panel(page).getByLabel('Groq API key')).toHaveCount(0);
});

test('the assistant builds a whole chain on the unit, shows what changed, and Undo/Redo replay it', async ({ page, unit }) => {
  const requests = await fakeGroq(page, [
    call('build_tone', { blocks: [
      { module: 'DRV', model: 'Fake Fuzz', params: [{ name: 'Fuzz', value: 80 }] },
      { module: 'AMP', model: 'Fake Plexi', params: [{ name: 'Gain', value: 60 }] },
      { module: 'DLY', model: 'Fake Echo', on: false },
    ] }),
    say('A Fuzz Face into a Plexi.'),
  ]);
  await connectMatribox(page);
  await pickCatalog(page);
  await openChat(page);
  await ask(page, 'Hendrix, Purple Haze');
  await expect(panel(page).getByText('A Fuzz Face into a Plexi.')).toBeVisible();

  // The model got the person's catalog (models with the gear they are based on) and the loaded preset.
  const first = requests[0]!.messages.at(-1)!.content!;
  expect(first).toContain('DRV: Fake Drive (Imaginary Overdrive 808); Fake Fuzz (Imaginary Fuzz Face)');
  expect(first).toContain('Name: Drive AD');

  await chain(page, 'DRV → AMP → DLY');
  expect(loaded(unit).chain.map((b) => [b.fxid, b.on, b.values[0]])).toEqual([[0x03000010, true, 80], [0x0700001a, true, 60], [0x0b000001, false, 0]]);
  const changes = panel(page).getByRole('region', { name: 'What changed' });
  await expect(changes.getByText('DYN DRV AMP CAB RVB VOL → DRV AMP DLY')).toBeVisible();
  await expect(changes.getByText('DRV · Fake Fuzz')).toHaveCount(2);

  await page.getByRole('button', { name: 'Undo' }).click();
  await chain(page, 'DYN → DRV → AMP → CAB → RVB → VOL');
  expect(loaded(unit).chain[2]!.values[0]).toBe(30);
  await page.getByRole('button', { name: 'Redo' }).click();
  await chain(page, 'DRV → AMP → DLY');
  expect(loaded(unit).chain[0]!.values[0]).toBe(80);
});

test('Undo and Redo replay the editor\'s own edits through the unit, from the buttons and the keyboard', async ({ page, unit }) => {
  await connectMatribox(page);
  await pickCatalog(page);
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  await page.getByRole('slider', { name: 'DRV Gain' }).fill('77');
  await expect.poll(() => loaded(unit).chain[1]!.values[0]).toBe(77);
  await page.getByRole('listitem', { name: /^2\. DRV/ }).getByRole('checkbox').check();
  await page.getByRole('listitem', { name: /^5\. RVB/ }).getByRole('button', { name: 'Remove' }).click();
  await chain(page, 'DYN → DRV → AMP → CAB → VOL');

  await undo.click();
  await chain(page, 'DYN → DRV → AMP → CAB → RVB → VOL');
  expect(loaded(unit).chain[4]!.values.slice(0, 2)).toEqual([25, 0]);
  await expect(undo).toBeEnabled();
  await page.locator('h1').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => loaded(unit).chain[1]!.on).toBe(false);
  await expect(undo).toBeEnabled(); // the step is kept (the editor is not busy any more)
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => loaded(unit).chain[1]!.values[0]).toBe(15);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await expect(undo).toBeDisabled(); // back where it started
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => loaded(unit).chain[1]!.values[0]).toBe(77);
});

test('the assistant only proposes a save: the person confirms it in the Save dialog', async ({ page, unit }) => {
  const requests = await fakeGroq(page, [call('save_preset', { slot: '2B', name: 'Purple Haze' }), say('Saved if you confirmed.')]);
  await connectMatribox(page);
  await pickCatalog(page);
  await openChat(page);
  await ask(page, 'save it on 2B');
  const dialog = page.getByRole('dialog', { name: 'Save to the Matribox' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Purple Haze');
  expect(unit.stored(5) ? parseMbPreset(unit.stored(5)!).name : '').not.toBe('Purple Haze');
  await dialog.getByRole('checkbox', { name: /Replace 2B/ }).check();
  await dialog.getByRole('button', { name: 'Save to 2B' }).click();
  await expect(dialog.getByText('Saved to 2B “Purple Haze”.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(panel(page).getByText('Saved if you confirmed.')).toBeVisible();
  expect(parseMbPreset(unit.stored(5)!).name).toBe('Purple Haze');
  expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('The person saved it to 2B');
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test('the Matribox assistant speaks Portuguese', async ({ page }) => {
    await connectMatribox(page);
    await expect(page.getByText(/só o catálogo de modelos diz isso/)).toBeVisible();
    await page.getByLabel('Escolher alg_data.json').setInputFiles(CATALOG_FILE);
    await expect(page.getByText('Catálogo de modelos: 10 modelos.')).toBeVisible();
    await expect(page.getByText(/o catálogo de modelos vão para o provedor da sua chave/)).toBeVisible();
  });
});
