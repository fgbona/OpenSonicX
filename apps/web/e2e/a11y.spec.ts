import AxeBuilder from '@axe-core/playwright';
import { test, expect, connect } from './fixtures.ts';
import { measure } from './contrast.ts';
import { openAssistantChat } from './assistant-chat.ts';

const CHAT = { panel: 'Tone assistant', keyRegion: 'Google Gemini key', keyLabel: 'Gemini API key', save: 'Save key', input: 'Message to the tone assistant', send: 'Send' };

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa'];
/** One model per amp finish (lib/ampSkins.ts). */
const FINISHES = ['TWD Deluxe', 'Dark Twin', 'Voks 30N', 'Brit 800', 'Calif DualM', 'Sol 100 OD', 'Halen 51', 'Eng 120', 'Bog XT', 'Jazz 120', 'A BassVT'];
const FACE_TEXT = '.face-amp :is(.knob-value, .knob-label, .amp-script, .editor-info)';

const violations = async (page: Parameters<typeof connect>[0]) =>
  (await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations before and after connecting (${theme} theme)`, async ({ page, pedal }) => {
    await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    expect(await violations(page)).toEqual([]);
    await connect(page, pedal);
    expect(await violations(page)).toEqual([]);
  });
}

// axe leaves text over gradients unmeasured ("incomplete"); those are measured from pixels.
for (const theme of ['dark', 'light'] as const) {
  test(`text over gradients is readable too (${theme} theme)`, async ({ page, pedal }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await connect(page, pedal);
    const { incomplete } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const failures: string[] = [];
    for (const node of incomplete.flatMap((v) => v.nodes)) {
      if (/non-text/.test(node.any[0]?.message ?? '')) continue;
      const r = await measure(page, page.locator(node.target.join(' ')).first());
      if (r && r.ratio < r.required) failures.push(`${node.target.join(' ')} "${r.text}": ${r.ratio.toFixed(2)} < ${r.required}`);
    }
    expect(failures).toEqual([]);
  });
}

// axe cannot read contrast over the faceplates' gradients and textures, so it is measured from pixels.
test('every amp finish keeps its text readable (WCAG AA contrast)', async ({ page, pedal }) => {
  test.setTimeout(180_000);
  await connect(page, pedal);
  await page.getByRole('switch', { name: 'Live edit' }).click();
  const failures: string[] = [];
  for (const model of FINISHES) {
    await page.locator('section.block-amp .picker-button').click();
    await page.getByRole('option', { name: new RegExp(`^${model}\\b`) }).click();
    await page.waitForTimeout(300);
    for (const el of await page.locator(FACE_TEXT).all()) {
      const r = await measure(page, el);
      if (r && r.ratio < r.required) failures.push(`${model} "${r.text}": ${r.ratio.toFixed(2)} < ${r.required}`);
    }
  }
  expect(failures).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`the tone assistant's chat has no WCAG A/AA violations (${theme} theme)`, async ({ page, pedal }) => {
    await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await connect(page, pedal);
    await page.getByRole('switch', { name: 'Live edit' }).click();
    await openAssistantChat(page, CHAT, 'Calif DualM, a Mesa Dual Rectifier.');
    expect(await violations(page)).toEqual([]);
    const { incomplete } = await new AxeBuilder({ page }).include('.assistant').withRules(['color-contrast']).analyze();
    const failures: string[] = [];
    for (const node of incomplete.flatMap((v) => v.nodes)) {
      if (/non-text/.test(node.any[0]?.message ?? '')) continue;
      const r = await measure(page, page.locator(node.target.join(' ')).first());
      if (r && r.ratio < r.required) failures.push(`${node.target.join(' ')} "${r.text}": ${r.ratio.toFixed(2)} < ${r.required}`);
    }
    expect(failures).toEqual([]);
  });
}
