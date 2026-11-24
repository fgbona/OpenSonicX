import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRegister } from '../lib/serviceWorker.ts';

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';
const ELECTRON = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/142.0 Electron/45.4.1 Safari/537.36';
const web = { production: true, supported: true, userAgent: CHROME, protocol: 'https:' };

test('the published web editor registers its service worker', () => {
  assert.equal(shouldRegister(web), true);
  assert.equal(shouldRegister({ ...web, protocol: 'http:' }), true, 'localhost and the container serve plain http');
});

test('no service worker in development, in the desktop app, or where the browser has none', () => {
  assert.equal(shouldRegister({ ...web, production: false }), false);
  assert.equal(shouldRegister({ ...web, userAgent: ELECTRON }), false);
  assert.equal(shouldRegister({ ...web, protocol: 'app:' }), false);
  assert.equal(shouldRegister({ ...web, supported: false }), false);
});
