import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileTone3000Store } from '../src/tone3000-store.ts';

test('the key file works like a shell file: the last assignment wins and the placeholder is skipped', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pm-t3k-'));
  delete process.env.TONE3000_CLIENT_ID;
  writeFileSync(join(home, 'tone3000.env'), "TONE3000_CLIENT_ID=...\nTONE3000_CLIENT_ID='real-key'\n");
  assert.equal(await fileTone3000Store(home).clientId(), 'real-key');
  writeFileSync(join(home, 'tone3000.env'), 'TONE3000_CLIENT_ID=...\n');
  await assert.rejects(fileTone3000Store(home).clientId(), /no TONE3000 key/);
});

test('tokens are stored owner-only and refreshed when about to expire', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pm-t3k-'));
  writeFileSync(join(home, 'tone3000.env'), 'TONE3000_CLIENT_ID=pk\n');
  let now = 1_000_000;
  const fetch = (async () => Response.json({ access_token: 'NEW', refresh_token: 'R2', expires_in: 3600 })) as unknown as typeof globalThis.fetch;
  const store = fileTone3000Store(home, fetch, () => now);
  assert.equal(await store.accessToken(), null);
  await store.save({ accessToken: 'OLD', refreshToken: 'R1', expiresAt: now + 3600_000 });
  assert.equal(statSync(join(home, 'tone3000-token.json')).mode & 0o777, 0o600);
  assert.equal(await store.accessToken(), 'OLD');
  now += 3600_000;
  assert.equal(await store.accessToken(), 'NEW');
});
