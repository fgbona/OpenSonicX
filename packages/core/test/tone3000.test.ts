import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeUrl, downloadModel, exchangeCode, listModels, pkcePair, pollDeviceToken, refreshTokens, searchTones, startDeviceLogin, TONE3000_API,
} from '../src/tone3000.ts';

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };

/** fetch that records calls and answers from a queue of [status, json | bytes]. */
function fakeFetch(answers: [number, unknown][]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? String(init.body) : null });
    const [status, body] = answers.shift() ?? [500, { error: 'no answer queued' }];
    return body instanceof Uint8Array ? new Response(body, { status }) : Response.json(body, { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const tokenJson = { access_token: 'AT', refresh_token: 'RT', token_type: 'bearer', expires_in: 3600, scope: 'read' };

test('PKCE: the challenge is the base64url SHA-256 of the verifier, and the authorize URL carries it', async () => {
  const { verifier, challenge } = await pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  assert.equal(challenge, digest);
  const url = new URL(authorizeUrl({ clientId: 'pk', redirectUri: 'http://localhost:3000/tone3000', challenge, state: 's1', prompt: 'select_tone' }));
  assert.equal(url.origin + url.pathname, `${TONE3000_API}/oauth/authorize`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: 'pk', redirect_uri: 'http://localhost:3000/tone3000', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1', prompt: 'select_tone',
  });
});

test('the code and refresh exchanges post the documented form fields and return expiring tokens', async () => {
  const f = fakeFetch([[200, tokenJson], [200, { ...tokenJson, access_token: 'AT2' }]]);
  const now = () => 1_000_000;
  const t = await exchangeCode({ clientId: 'pk', code: 'C', verifier: 'V', redirectUri: 'http://x/cb' }, f.fetch, now);
  assert.deepEqual(t, { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 + 3600_000 });
  assert.equal(f.calls[0]!.url, `${TONE3000_API}/oauth/token`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[0]!.body!)), { grant_type: 'authorization_code', code: 'C', code_verifier: 'V', redirect_uri: 'http://x/cb', client_id: 'pk' });
  const r = await refreshTokens({ clientId: 'pk', refreshToken: 'RT' }, f.fetch, now);
  assert.equal(r.accessToken, 'AT2');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[1]!.body!)), { grant_type: 'refresh_token', refresh_token: 'RT', client_id: 'pk' });
});

test('device login shows a code, then polling waits through pending and slow_down until approved', async () => {
  const f = fakeFetch([
    [200, { device_code: 'D', user_code: 'ABCD-EFGH', verification_uri: 'https://www.tone3000.com/activate', verification_uri_complete: 'https://www.tone3000.com/activate?code=ABCD-EFGH', expires_in: 600, interval: 5 }],
    [400, { error: 'authorization_pending' }],
    [400, { error: 'slow_down' }],
    [200, tokenJson],
  ]);
  const start = await startDeviceLogin('pk', f.fetch);
  assert.equal(start.userCode, 'ABCD-EFGH');
  const waits: number[] = [];
  const tokens = await pollDeviceToken({ clientId: 'pk', start }, f.fetch, { sleep: async (ms) => void waits.push(ms), now: () => 0 });
  assert.equal(tokens.accessToken, 'AT');
  assert.deepEqual(waits, [5000, 5000, 10000]);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[1]!.body!)), { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'D', client_id: 'pk' });
});

test('a declined or expired device login stops with a readable error', async () => {
  const start = { deviceCode: 'D', userCode: 'X', verificationUri: 'u', verificationUriComplete: 'u', expiresIn: 600, interval: 5 };
  const declined = fakeFetch([[400, { error: 'access_denied' }]]);
  await assert.rejects(pollDeviceToken({ clientId: 'pk', start }, declined.fetch, { sleep: async () => undefined, now: () => 0 }), /declined/);
  const expired = fakeFetch([[400, { error: 'expired_token' }]]);
  await assert.rejects(pollDeviceToken({ clientId: 'pk', start }, expired.fetch, { sleep: async () => undefined, now: () => 0 }), /expired/);
});

test('search sends the bearer token and documented filters and maps the tones', async () => {
  const f = fakeFetch([[200, {
    page: 1, page_size: 10, total: 1, total_pages: 1,
    data: [{ id: 42, title: 'GK 250ML Lead', gear: 'amp', format: 'nam', makes: ['Gallien-Krueger'], user: { username: 'tonehead' }, models_count: 3, downloads_count: 99, url: 'https://www.tone3000.com/tones/gk-250ml-42', images: ['https://img/1.png'], description: 'Somewhere in Time' }],
  }]]);
  const page = await searchTones('AT', { query: 'gallien krueger 250ml', format: 'nam', gears: ['amp', 'full-rig'] }, f.fetch);
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.pathname, '/api/v1/tones/search');
  assert.deepEqual(Object.fromEntries(url.searchParams), { query: 'gallien krueger 250ml', format: 'nam', gears: 'amp_full-rig', page: '1', page_size: '10' });
  assert.equal(f.calls[0]!.headers.authorization, 'Bearer AT');
  assert.deepEqual(page.tones[0], { id: 42, title: 'GK 250ML Lead', gear: 'amp', format: 'nam', makes: ['Gallien-Krueger'], creator: 'tonehead', modelsCount: 3, downloads: 99, url: 'https://www.tone3000.com/tones/gk-250ml-42', image: 'https://img/1.png', description: 'Somewhere in Time' });
  assert.equal(page.total, 1);
});

test('models are listed per tone and a model downloads with the bearer token', async () => {
  const f = fakeFetch([[200, { page: 1, page_size: 300, total: 1, total_pages: 1, data: [{ id: 7, name: 'Lead 5', size: 'standard', model_url: 'https://cdn.example/7.nam', architecture_version: '1' }] }], [200, new Uint8Array([1, 2, 3])]]);
  const models = await listModels('AT', 42, f.fetch);
  assert.deepEqual(models, [{ id: 7, name: 'Lead 5', size: 'standard', url: 'https://cdn.example/7.nam', architecture: '1' }]);
  assert.match(f.calls[0]!.url, /\/models\?tone_id=42&page_size=300$/);
  assert.deepEqual([...await downloadModel('AT', models[0]!.url, f.fetch)], [1, 2, 3]);
  assert.equal(f.calls[1]!.headers.authorization, 'Bearer AT');
});

test('API errors become readable errors, and a lapsed token says to sign in again', async () => {
  const f = fakeFetch([[401, { error: 'unauthorized' }], [429, { error: 'rate_limited' }]]);
  await assert.rejects(searchTones('old', { query: 'x' }, f.fetch), /sign in to TONE3000 again/);
  await assert.rejects(searchTones('AT', { query: 'x' }, f.fetch), /TONE3000 is limiting requests/);
});
