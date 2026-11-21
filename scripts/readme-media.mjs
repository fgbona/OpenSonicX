#!/usr/bin/env node
// Regenerates the README's screenshots and tube animation from the dev-only /preview page
// (a stored preset, no pedal). Needs `npm run dev` running, Google Chrome installed (the bundled
// headless shell skips the knobs' SVG gradient) and ffmpeg on PATH (for the GIF).
// Usage: node scripts/readme-media.mjs [http://localhost:3000/preview]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3000/preview';
const out = new URL('../docs/media/', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'readme-media-'));
mkdirSync(out, { recursive: true });

const FINISHES = ['TWD Deluxe', 'Voks 30TB', 'Brit 800', 'Calif DualM', 'Sol 100 LD', 'Eng Power', 'Bog XT', 'Halen 51'];
const WARM_UP_MS = 1800; // the tube's warm-up animation

/** JPEG at 2x: a fraction of the PNG's size, still sharp on the dark UI. */
const shot = (name) => ({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });

async function open(context) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('.face-amp');
  // The preview's own controls are not part of the product.
  await page.addStyleTag({ content: '.main > label.muted, .main > .btn, nextjs-portal { display: none !important; }' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function pick(page, model) {
  await page.click('.block-amp .picker-button');
  await page.locator('.picker-option', { has: page.locator('.picker-name', { hasText: new RegExp(`^${model}$`) }) }).click();
  await page.waitForTimeout(WARM_UP_MS);
  await page.evaluate(() => document.fonts.ready);
}

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'en-US' });
  const page = await open(context);

  await pick(page, 'Brit 800');
  const amp = await page.locator('section.block-amp').boundingBox();
  await page.screenshot({ ...shot('editor'), clip: { x: 0, y: 0, width: 1440, height: amp.y + amp.height + 32 } });

  for (const model of FINISHES) {
    await pick(page, model);
    const name = `amp-${model.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await page.locator('section.block-amp').screenshot(shot(name));
  }

  await pick(page, 'Brit 800');
  await page.click('.block-amp .picker-button');
  const head = await page.locator('section.block-amp').boundingBox();
  const list = await page.locator('.picker-list').boundingBox();
  await page.screenshot({ ...shot('menu'), clip: { x: head.x, y: head.y, width: head.width, height: list.y + list.height - head.y + 16 } });
  await context.close();

  // The tube warming up when the AMP block is switched on: record, then crop to the faceplate.
  const video = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', locale: 'en-US', recordVideo: { dir: tmp, size: { width: 1440, height: 1000 } } });
  const vpage = await open(video);
  await pick(vpage, 'Brit 800');
  const face = await vpage.locator('.face-amp').boundingBox();
  const power = vpage.locator('section.block-amp .editor-head .switch');
  await power.click();
  await vpage.waitForTimeout(900);
  await power.click();
  await vpage.waitForTimeout(3200);
  await video.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  const [x, y, w, h] = [face.x, face.y, face.width, face.height].map(Math.round);
  // Keep the last ~4 s (switch off, back on, warm-up, breathing).
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-4.3', '-i', join(tmp, webm),
    '-vf', `crop=${w}:${h}:${x}:${y},fps=20,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', join(out, 'tube.gif')]);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.info(`media written to ${out}`);
