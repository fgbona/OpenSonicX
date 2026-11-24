import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cacheKeyFor, isStaleCache, precacheUrls } from '../lib/precache.ts';
import { precacheManifest } from '../scripts/precache-manifest.ts';

test('every file of the export is precached under the base path, except the worker itself and link-preview images', () => {
  const files = ['index.html', '_next/static/chunks/a.js', 'sw.js', 'opengraph-image.jpg', 'convert-worker.js', 'x.js.map', 'icons/icon-192.png'];
  assert.deepEqual(precacheUrls(files, '/OpenSonicX'), ['/OpenSonicX/_next/static/chunks/a.js', '/OpenSonicX/convert-worker.js', '/OpenSonicX/icons/icon-192.png', '/OpenSonicX/index.html']);
  assert.deepEqual(precacheUrls(['index.html'], ''), ['/index.html']);
});

test('a request maps to the file it is served from: folders to index.html, pages without extension to .html', () => {
  assert.equal(cacheKeyFor('/OpenSonicX/', '/OpenSonicX', true), '/OpenSonicX/index.html');
  assert.equal(cacheKeyFor('/OpenSonicX', '/OpenSonicX', true), '/OpenSonicX/index.html');
  assert.equal(cacheKeyFor('/OpenSonicX/preview', '/OpenSonicX', true), '/OpenSonicX/preview.html');
  assert.equal(cacheKeyFor('/OpenSonicX/_next/static/chunks/a.js', '/OpenSonicX', false), '/OpenSonicX/_next/static/chunks/a.js');
  assert.equal(cacheKeyFor('/OpenSonicX/index.txt', '/OpenSonicX', false), '/OpenSonicX/index.txt');
  assert.equal(cacheKeyFor('/', '', true), '/index.html');
});

test('requests outside the base path are never answered from the cache', () => {
  assert.equal(cacheKeyFor('/other/index.html', '/OpenSonicX', false), null);
  assert.equal(cacheKeyFor('/OpenSonicXtra/a.js', '/OpenSonicX', false), null);
});

test('on activation only the caches of older releases of this app are dropped', () => {
  assert.equal(isStaleCache('opensonicx-1.0.0-aaaa', 'opensonicx-1.0.1-bbbb'), true);
  assert.equal(isStaleCache('opensonicx-1.0.1-bbbb', 'opensonicx-1.0.1-bbbb'), false);
  assert.equal(isStaleCache('someone-else', 'opensonicx-1.0.1-bbbb'), false);
});

function exportDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

test('the cache is named after the release and the content of the export', () => {
  const a = precacheManifest(exportDir({ 'index.html': 'v1', '_next/static/a.js': 'x', 'sw.js': 'old' }), '/OpenSonicX', '1.0.0');
  assert.deepEqual(a.urls, ['/OpenSonicX/_next/static/a.js', '/OpenSonicX/index.html']);
  assert.match(a.cacheName, /^opensonicx-1\.0\.0-[0-9a-f]{10}$/);

  const same = precacheManifest(exportDir({ '_next/static/a.js': 'x', 'index.html': 'v1', 'sw.js': 'other' }), '/OpenSonicX', '1.0.0');
  assert.equal(same.cacheName, a.cacheName, 'same files, same cache (the worker itself does not count)');

  const edited = precacheManifest(exportDir({ 'index.html': 'v2', '_next/static/a.js': 'x' }), '/OpenSonicX', '1.0.0');
  assert.notEqual(edited.cacheName, a.cacheName, 'a changed file is a new cache');

  const renamed = precacheManifest(exportDir({ 'index.html': 'v1', '_next/static/b.js': 'x' }), '/OpenSonicX', '1.0.0');
  assert.notEqual(renamed.cacheName, a.cacheName, 'a renamed file is a new cache');

  const released = precacheManifest(exportDir({ 'index.html': 'v1', '_next/static/a.js': 'x' }), '/OpenSonicX', '1.0.1');
  assert.match(released.cacheName, /^opensonicx-1\.0\.1-/);
});
