import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_URL_PATH, matriboxCatalogPath } from '../src/matribox-catalog.ts';

test('the Matribox catalog comes from MATRIBOX_CATALOG, else the official app install', () => {
  assert.equal(matriboxCatalogPath({ MATRIBOX_CATALOG: '/tmp/alg.json' }, 'darwin'), '/tmp/alg.json');
  assert.equal(matriboxCatalogPath({ MATRIBOX_CATALOG: ' ' }, 'darwin'), null);
  assert.equal(matriboxCatalogPath({}, 'darwin'), '/Applications/Matribox II PRO.app/Contents/Frameworks/App.framework/Resources/flutter_assets/assets/alg/alg_data.json');
  assert.equal(matriboxCatalogPath({ ProgramFiles: 'D:\\Apps' }, 'win32'), 'D:\\Apps\\Matribox II PRO\\data\\flutter_assets\\assets\\alg\\alg_data.json');
  assert.equal(matriboxCatalogPath({}, 'linux'), null);
});

test('the web app asks for it at one fixed path of the app origin', () => {
  assert.equal(CATALOG_URL_PATH, '/matribox-catalog.json');
});
