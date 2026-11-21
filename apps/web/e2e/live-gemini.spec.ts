import { test, expect, connect } from './fixtures.ts';

// The one test that talks to the real Gemini, with the owner's free key, against the simulated pedal.
// Skipped unless the key is in the environment:  GEMINI_API_KEY=AIza... npm run e2e:gemini
// It uses one or two of the day's free requests and never prints the key.
const KEY = process.env.GEMINI_API_KEY;
test.skip(!KEY, 'set GEMINI_API_KEY to run against the real Gemini');
test.setTimeout(120_000);

test('a real Gemini builds a tone on the simulated pedal', async ({ page, pedal }) => {
  await connect(page, pedal);
  await page.getByRole('switch', { name: 'Live edit' }).click();
  const panel = page.getByRole('region', { name: 'Tone assistant' });
  await panel.getByLabel('Gemini API key').fill(KEY!);
  await panel.getByRole('button', { name: 'Save key' }).click();
  await expect(panel.getByRole('button', { name: 'Remove key' })).toBeVisible({ timeout: 20_000 });
  await panel.getByRole('textbox', { name: 'Message to the tone assistant' }).fill('Metallica Black Album rhythm tone');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('.assistant-message.is-assistant, .assistant-message.is-error').last()).not.toHaveText(/Working on it/, { timeout: 90_000 });
  const answer = await panel.locator('.assistant-message').last().innerText();
  console.log(`\nGemini answered:\n${answer}\n`);
  await expect(panel.locator('.assistant-message.is-error')).toHaveCount(0);
  expect(pedal.pedal.received.some((r) => r.startsWith('edit')), 'the assistant changed the sound').toBe(true);
});
