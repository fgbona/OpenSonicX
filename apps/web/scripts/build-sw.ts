// Writes out/sw.js, the offline service worker (lib/sw.ts), once `next build` made the static
// export (NEXT_OUTPUT=export: GitHub Pages and the desktop app). The container's standalone
// server has no out/ and gets no service worker.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { precacheManifest } from './precache-manifest.ts';

if (process.env.NEXT_OUTPUT === 'export') {
  const out = new URL('../out/', import.meta.url).pathname;
  const basePath = process.env.NEXT_BASE_PATH ?? '';
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const { cacheName, urls } = precacheManifest(out, basePath, version);
  await build({
    entryPoints: [new URL('../lib/sw.ts', import.meta.url).pathname],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    outfile: `${out}sw.js`,
    logLevel: 'warning',
    define: { __CACHE_NAME__: JSON.stringify(cacheName), __PRECACHE__: JSON.stringify(urls), __BASE_PATH__: JSON.stringify(basePath) },
  });
  console.log(`sw.js: ${urls.length} files precached in ${cacheName}`);
}
