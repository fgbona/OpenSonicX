import { test, expect, connect } from './fixtures.ts';
// A tablet with a mouse: hover exists (blocks stay draggable), the strip is too narrow for the chain.
test.describe('a narrow screen with a mouse', () => {
  test.use({ viewport: { width: 760, height: 1000 } });

  test('the wheel and the › button scroll the chain; block names are not selectable', async ({ page, pedal }) => {
    await connect(page, pedal);
    const strip = page.locator('.tiles');
    await page.getByRole('button', { name: 'Show later blocks' }).click();
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await strip.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await strip.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(page.locator('.tiles .tile-model').first()).toHaveCSS('user-select', 'none');
  });
});
