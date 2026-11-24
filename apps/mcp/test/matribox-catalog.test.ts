import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMatriboxCatalog, matriboxCatalogPath } from '../src/matribox-catalog.ts';

// Synthetic catalog, invented content; the real file is Sonicake's and is never used in tests.
const SYNTHETIC = {
  Modules: [{ name: 'FX', index: 0, alg: [{ fxid: 7, index: 0, name: 'Made Up Chorus', widget: [{ name: 'Rate', ID: '0', defaultValue: '5', min: '0', max: '10', step: '1' }] }] }],
};

const tempFile = (content: string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'mb-cat-')), 'alg_data.json');
  writeFileSync(path, content);
  return path;
};

test('MATRIBOX_CATALOG overrides the default path on every platform', () => {
  assert.equal(matriboxCatalogPath({ MATRIBOX_CATALOG: '/x/alg_data.json' }, 'darwin'), '/x/alg_data.json');
  assert.equal(matriboxCatalogPath({ MATRIBOX_CATALOG: '  ' }, 'linux'), null);
});

test('default paths: the installed official app on macOS and Windows, none elsewhere', () => {
  assert.equal(matriboxCatalogPath({}, 'darwin'), '/Applications/Matribox II PRO.app/Contents/Frameworks/App.framework/Resources/flutter_assets/assets/alg/alg_data.json');
  assert.match(matriboxCatalogPath({ ProgramFiles: 'D:\\Apps' }, 'win32') ?? '', /^D:\\Apps\\Matribox II PRO\\data\\flutter_assets\\assets\\alg\\alg_data\.json$/);
  assert.match(matriboxCatalogPath({}, 'win32') ?? '', /^C:\\Program Files\\/);
  assert.equal(matriboxCatalogPath({}, 'linux'), null);
});

test('loads and validates a catalog file', async () => {
  const catalog = await loadMatriboxCatalog(tempFile(JSON.stringify(SYNTHETIC)));
  assert.equal(catalog.modules[0]?.models[0]?.name, 'Made Up Chorus');
  assert.equal(catalog.modules[0]?.models[0]?.params[0]?.max, 10);
});

test('clear errors: no path, missing file, bad JSON, bad shape', async () => {
  await assert.rejects(loadMatriboxCatalog(null), /MATRIBOX_CATALOG/);
  await assert.rejects(loadMatriboxCatalog('/nonexistent/alg_data.json'), /not found.*\/nonexistent\/alg_data\.json/s);
  await assert.rejects(loadMatriboxCatalog(tempFile('{not json')), /not valid JSON/);
  await assert.rejects(loadMatriboxCatalog(tempFile('{"Modules": 3}')), /Modules must be an array/);
});
