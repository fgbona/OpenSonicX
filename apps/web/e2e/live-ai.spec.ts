import { test, expect, connect } from './fixtures.ts';

// The only tests that talk to real AI providers, with the owner's free keys, against the simulated
// pedal. Each runs only when its key is in the environment:
//   GROQ_API_KEY=gsk_... GEMINI_API_KEY=AIza... npm run e2e:live
// Each uses one or two of the day's free requests and never prints the key.
test.setTimeout(120_000);

const PROVIDERS = [
  { name: 'Groq', env: 'GROQ_API_KEY', region: 'Groq key', label: 'Groq API key', via: 'Answered by Groq' },
  { name: 'Gemini', env: 'GEMINI_API_KEY', region: 'Google Gemini key', label: 'Gemini API key', via: 'Answered by Gemini Flash' },
] as const;

for (const p of PROVIDERS) {
  const key = process.env[p.env];
  test(`real ${p.name} builds a tone on the simulated pedal`, async ({ page, pedal }) => {
    test.skip(!key, `set ${p.env} to run against the real ${p.name}`);
    await connect(page, pedal);
    await page.getByRole('switch', { name: 'Live edit' }).click();
    const panel = page.getByRole('region', { name: 'Tone assistant' });
    const setup = panel.getByRole('region', { name: p.region });
    await setup.getByLabel(p.label).fill(key!);
    await setup.getByRole('button', { name: 'Save key' }).click();
    await expect(panel.getByRole('button', { name: 'Keys' })).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('textbox', { name: 'Message to the tone assistant' }).fill('Metallica Black Album rhythm tone');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByText('Working on it…')).toBeHidden({ timeout: 90_000 });
    console.log(`\n${p.name} answered:\n${await panel.locator('.assistant-message').last().innerText()}\n`);
    await expect(panel.locator('.assistant-message.is-error')).toHaveCount(0);
    await expect(panel.getByText(p.via)).toBeVisible();
    expect(pedal.pedal.received.some((r) => r.startsWith('edit')), 'the assistant changed the sound').toBe(true);
  });
}
