import { test, expect } from './fixtures.ts';

test.use({ plugged: [] });

// Content that appears after hydration (the Bluetooth button did) pushes the page down on a phone.
test('the page does not shift while it loads on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.addInitScript(() => {
    (window as unknown as { cls: number }).cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.05);
});
