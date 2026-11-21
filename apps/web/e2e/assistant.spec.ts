import { test, expect, connect } from './fixtures.ts';
import type { Page, Route } from '@playwright/test';

// Gemini is simulated: every call to Google is answered here, so nothing leaves the machine.
const KEY = 'AIzaTESTKEY-e2e-0000000000000000000000';

type Reply = { status?: number; body: unknown };
const call = (name: string, args: unknown, id = 'c1'): Reply => ({ body: { status: 'requires_action', steps: [{ type: 'function_call', id, name, arguments: args }] } });
const say = (text: string): Reply => ({ body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] } });

/** Answers Gemini requests with `replies` in order; returns the request bodies. */
async function fakeGemini(page: Page, replies: Reply[], keyOk = true) {
  const requests: Record<string, unknown>[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/models')) {
      return route.fulfill(keyOk ? { json: { models: [] } } : { status: 400, json: { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } });
    }
    requests.push(route.request().postDataJSON());
    const r = replies.shift() ?? say('(no more scripted replies)');
    return route.fulfill({ status: r.status ?? 200, json: r.body });
  });
  return requests;
}

const panel = (page: Page) => page.getByRole('region', { name: 'Tone assistant' });
const amp = (page: Page) => page.locator('section.block-amp');

async function addKey(page: Page) {
  await panel(page).getByLabel('Gemini API key').fill(KEY);
  await panel(page).getByRole('button', { name: 'Save key' }).click();
  await expect(panel(page).getByRole('button', { name: 'Remove key' })).toBeVisible();
}

async function ask(page: Page, text: string) {
  await panel(page).getByRole('textbox', { name: 'Message to the tone assistant' }).fill(text);
  await panel(page).getByRole('button', { name: 'Send' }).click();
}

test('the key is checked before it is kept, and never shown back', async ({ page, pedal }) => {
  await fakeGemini(page, [], false);
  await connect(page, pedal);
  await expect(panel(page).getByRole('link', { name: 'Open Google AI Studio' })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await expect(panel(page).getByText(/must say Free tier/)).toBeVisible();
  await panel(page).getByLabel('Gemini API key').fill('AIza-wrong');
  await panel(page).getByRole('button', { name: 'Save key' }).click();
  await expect(panel(page).getByText('Google did not accept this key.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pocket-master-editor.geminiKey.v1'))).toBeNull();

  await page.unroute('https://generativelanguage.googleapis.com/**');
  await fakeGemini(page, []);
  await addKey(page);
  await expect(page.locator('body')).not.toContainText(KEY);
});

test('describing a tone builds it live, lists what changed, and Undo takes it back', async ({ page, pedal }) => {
  const requests = await fakeGemini(page, [
    call('edit_preset', { changes: [{ kind: 'model', block: 'AMP', model: 'Calif DualM' }, { kind: 'parameter', block: 'AMP', parameter: 'Gain', value: 70 }] }),
    say('Mesa Dual Rectifier with gain 70, like the Black Album rhythm.'),
  ]);
  await connect(page, pedal);
  await page.getByRole('switch', { name: 'Live edit' }).click();
  await addKey(page);
  await ask(page, 'black album rhythm tone');
  await expect(panel(page).getByText('Mesa Dual Rectifier with gain 70', { exact: false })).toBeVisible();
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'mesa');
  await expect.poll(() => pedal.pedal.received).toContain('edit 47');
  await expect(panel(page).getByRole('region', { name: 'What changed' }).getByRole('listitem').filter({ hasText: 'AMP Model' })).toContainText('Brit 800 → Calif DualM');
  await expect(panel(page).getByText(/1 of 20 free requests|2 of 20 free requests/)).toBeVisible();
  // The first message carried the preset and the models; the key only went in a header.
  expect(JSON.stringify(requests[0])).toContain('Loaded preset:');
  expect(JSON.stringify(requests)).not.toContain(KEY);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(amp(page).locator('.face-amp')).toHaveAttribute('data-skin', 'marshall');
});

test('with Live edit off the assistant asks for it instead of changing the sound', async ({ page, pedal }) => {
  await fakeGemini(page, [call('edit_preset', { changes: [{ kind: 'volume', value: 50 }] }), say('Turn on Live edit and I will do it.')]);
  await connect(page, pedal);
  await addKey(page);
  await ask(page, 'louder');
  await expect(panel(page).getByText('Turn on Live edit so the assistant can change the sound.')).toBeVisible();
  expect(pedal.pedal.received.filter((r) => r.startsWith('edit'))).toEqual([]);
  await panel(page).getByRole('button', { name: 'Turn on Live edit' }).click();
  await expect(page.getByText(/Live edit is on/)).toBeVisible();
});

test('saving is only a proposal: the Save dialog opens filled in, and Cancel saves nothing', async ({ page, pedal }) => {
  const requests = await fakeGemini(page, [call('save_preset', { slot: 'P45', name: 'BLACK ALB' }), say('Not saved, as you prefer.')]);
  await connect(page, pedal);
  await page.getByRole('switch', { name: 'Live edit' }).click();
  await addKey(page);
  await ask(page, 'save it on 45');
  const dialog = page.getByRole('dialog', { name: 'Save to a preset slot' });
  await expect(dialog.getByLabel('Slot')).toHaveValue('44');
  await expect(dialog.getByLabel('Name')).toHaveValue('BLACK ALB');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page).getByText('Not saved, as you prefer.')).toBeVisible();
  expect(pedal.pedal.received.some((r) => r.startsWith('save'))).toBe(false);
  expect(JSON.stringify(requests[1])).toContain('did not save');
});

test('a used-up free quota says when it comes back, and offers Flash-Lite', async ({ page, pedal }) => {
  const quota: Reply = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }] } } };
  const requests = await fakeGemini(page, [quota, say('Hello from Flash-Lite')]);
  await connect(page, pedal);
  await addKey(page);
  await ask(page, 'hi');
  await expect(panel(page).getByText(/The free quota for now is used up\. It resets at/)).toBeVisible();
  await panel(page).getByRole('button', { name: /Use Gemini Flash-Lite instead/ }).click();
  await ask(page, 'hi again');
  await expect(panel(page).getByText('Hello from Flash-Lite')).toBeVisible();
  expect(requests[1]!.model).toBe('gemini-3.5-flash-lite');
});

test('what a tool reports matches the pedal: loading, reverting, and undo with Live edit off', async ({ page, pedal }) => {
  const requests = await fakeGemini(page, [
    call('undo_edit', {}), say('Live edit is off.'),
    call('select_preset', { preset: 'P10' }), say('Loaded P10.'),
    call('edit_preset', { changes: [{ kind: 'volume', value: 50 }] }, 'c3'), call('revert_preset', {}, 'c4'), say('Back as it was.'),
  ]);
  await connect(page, pedal);
  await addKey(page);
  await ask(page, 'undo that');
  await expect(panel(page).getByText('Live edit is off.')).toBeVisible();
  expect(JSON.stringify(requests[1])).toMatch(/Live edit is off, so the sound cannot change/);

  await page.getByRole('switch', { name: 'Live edit' }).click();
  await ask(page, 'load P10');
  await expect(page.getByRole('heading', { name: /P10\s*THR-CLEAN/ })).toBeVisible();
  const loaded = JSON.stringify((requests[3]!.input as unknown[]).at(-1));
  expect(loaded).toContain('P10 \\"THR-CLEAN\\"');
  expect(loaded).toContain('unsaved changes: no');

  await ask(page, 'louder, then put it back');
  await expect(panel(page).getByText('Back as it was.')).toBeVisible();
  const reverted = JSON.stringify((requests[6]!.input as unknown[]).at(-1));
  expect(reverted).toContain('Reverted to the saved preset.');
  expect(reverted).toContain('unsaved changes: no');
});
