import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDesktopAgent } from '../lib/desktop.ts';

test('the desktop app is recognised by the Electron token in its user agent', () => {
  assert.equal(isDesktopAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/142.0 Electron/45.2.3 Safari/537.36'), true);
  assert.equal(isDesktopAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/142.0 Safari/537.36'), false);
});
