import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAppFile } from '../src/serve.ts';

const root = mkdtempSync(join(tmpdir(), 'pm-desktop-'));
mkdirSync(join(root, '_next', 'static'), { recursive: true });
for (const f of ['index.html', 'preview.html', 'convert-worker.js', '_next/static/app.js', '404.html']) writeFileSync(join(root, f), f);

test('app:// paths map to the static export: pages without extension get .html', () => {
  assert.equal(resolveAppFile(root, 'app://editor/'), join(root, 'index.html'));
  assert.equal(resolveAppFile(root, 'app://editor/preview'), join(root, 'preview.html'));
  assert.equal(resolveAppFile(root, 'app://editor/convert-worker.js?v=1'), join(root, 'convert-worker.js'));
  assert.equal(resolveAppFile(root, 'app://editor/_next/static/app.js'), join(root, '_next', 'static', 'app.js'));
});

test('unknown paths fall back to 404.html and nothing outside the export is served', () => {
  assert.equal(resolveAppFile(root, 'app://editor/missing'), join(root, '404.html'));
  assert.equal(resolveAppFile(root, 'app://editor/..%2F..%2Fetc%2Fpasswd'), join(root, '404.html'));
  assert.equal(resolveAppFile(root, 'app://editor/%2e%2e/secret'), join(root, '404.html'));
});
