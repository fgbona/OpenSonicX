/**
 * The installable, offline web app (playwright.pwa.config.ts: the static export under /OpenSonicX).
 * The fixtures fake Web MIDI as everywhere else; no pedal is plugged in.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';

test.use({ plugged: [] });

const HOME = '/OpenSonicX/';

/** Opens the editor and waits until the service worker controls the page (precache done). */
async function openInstalled(page: Page) {
  await page.goto(HOME);
  await expect(page.getByRole('heading', { name: 'Plug in your pedal' })).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready) && navigator.serviceWorker.controller !== null);
}

test('serves a valid web app manifest with installable icons', async ({ page, request }) => {
  await page.goto(HOME);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/OpenSonicX/manifest.webmanifest');
  const res = await request.get('/OpenSonicX/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: 'OpenSonicX: Sonicake Pocket Master & Matribox II Pro editor',
    short_name: 'OpenSonicX',
    start_url: HOME,
    scope: HOME,
    display: 'standalone',
    theme_color: '#0b0d10',
  });
  expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  for (const icon of manifest.icons as { src: string }[]) {
    const png = await request.get(icon.src);
    expect(png.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('Chrome finds nothing missing to install it as an app', async ({ page }) => {
  await openInstalled(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('opens offline after the first visit, from a cache of the app files only', async ({ page, context }) => {
  await openInstalled(page);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = (await Promise.all(names.map(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url)))).flat();
    return { names, urls };
  });
  expect(cached.names).toEqual([expect.stringMatching(/^opensonicx-\d+\.\d+\.\d+-[0-9a-f]{10}$/)]);
  expect(cached.urls.every((u) => u.startsWith(new URL(HOME, page.url()).href))).toBe(true);
  expect(cached.urls).toContainEqual(expect.stringMatching(/\/convert-worker\.js$/));

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plug in your pedal' })).toBeVisible();
  // The NAM converter's worker starts offline too.
  expect(await page.evaluate(async () => (await fetch('/OpenSonicX/convert-worker.js')).ok)).toBe(true);
  // Anything outside the app still goes to the (here absent) network.
  expect(
    await page.evaluate(() =>
      fetch('https://api.tone3000.com/').then(
        () => 'online',
        () => 'offline',
      ),
    ),
  ).toBe('offline');
});

test('a new release waits for the reload button instead of reloading by itself', async ({ page }) => {
  await openInstalled(page);
  await page.evaluate(() => {
    (window as unknown as { unsaved: boolean }).unsaved = true;
  });
  await page.request.post('/__release');
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });

  const prompt = page.getByRole('status').filter({ hasText: 'A new version of the editor is ready.' });
  await expect(prompt).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { unsaved?: boolean }).unsaved)).toBe(true);

  const reloaded = page.waitForEvent('load');
  await prompt.getByRole('button', { name: 'Reload' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Plug in your pedal' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { unsaved?: boolean }).unsaved)).toBeUndefined();
  await expect(prompt).toBeHidden();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).toBeNull();
});
