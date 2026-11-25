import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { BodyTooLarge, checkRequest, maskToken, newToken, RateLimiter, readBody, tokenMatches } from '../src/ai-guard.ts';
import { approvalFor, needsApproval, withConfirm } from '../src/ai-approval.ts';
import { disable, enable, loadAiSettings, OFF, regenerate, saveAiSettings } from '../src/ai-settings.ts';

const TOKEN = newToken();
const ok = { host: '127.0.0.1:47830', authorization: `Bearer ${TOKEN}` };
const check = (headers: Record<string, string>, url = '/mcp', allowedOrigins?: string[]) => checkRequest({ method: 'POST', url, headers }, { port: 47830, token: TOKEN, allowedOrigins });

test('tokens are 256 random bits, URL-safe, and shown masked', () => {
  assert.match(TOKEN, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(TOKEN, 'base64url').length, 32);
  assert.notEqual(newToken(), TOKEN);
  const masked = maskToken(TOKEN);
  assert.ok(!masked.includes(TOKEN.slice(0, 39)));
  assert.ok(masked.endsWith(TOKEN.slice(-4)));
});

test('the bearer token must match exactly', () => {
  assert.equal(tokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(undefined, TOKEN), false);
  assert.equal(tokenMatches('', TOKEN), false);
  assert.equal(tokenMatches(TOKEN, TOKEN), false, 'no Bearer scheme');
  assert.equal(tokenMatches(`Basic ${TOKEN}`, TOKEN), false);
  assert.equal(tokenMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(tokenMatches(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN), false);
  assert.equal(tokenMatches('Bearer ', ''), false, 'an empty token never matches');
});

test('a request with our Host, no Origin and the token passes', () => {
  assert.equal(check(ok), null);
  assert.equal(check({ ...ok, host: 'localhost:47830' }), null);
  assert.equal(check(ok, '/mcp?x=1'), null);
});

test('any other Host is refused (DNS rebinding)', () => {
  for (const host of ['evil.example:47830', '127.0.0.1:1234', '127.0.0.1', 'localhost', '0.0.0.0:47830', '[::1]:47830', '127.0.0.1.evil.example:47830']) {
    assert.deepEqual(check({ ...ok, host }), { status: 403, message: 'Host not allowed' }, host);
  }
  assert.equal(check({ authorization: ok.authorization })?.status, 403, 'no Host at all');
});

test('a request with an Origin is refused unless allowed (browsers, CSRF)', () => {
  for (const origin of ['https://evil.example', 'http://127.0.0.1:47830', 'null', 'app://editor']) {
    assert.deepEqual(check({ ...ok, origin }), { status: 403, message: 'Origin not allowed' }, origin);
  }
  assert.equal(check({ ...ok, origin: 'https://tool.example' }, '/mcp', ['https://tool.example']), null);
  assert.equal(check({ ...ok, origin: 'https://other.example' }, '/mcp', ['https://tool.example'])?.status, 403);
});

test('only /mcp is served, and never without the token', () => {
  assert.equal(check(ok, '/')?.status, 404);
  assert.equal(check(ok, '/mcp/../x')?.status, 404);
  assert.deepEqual(check({ host: ok.host }), { status: 401, message: 'Missing or wrong bearer token' });
  assert.equal(check({ ...ok, authorization: 'Bearer wrong' })?.status, 401);
  // Host and Origin come first: a page cannot even learn whether its guess of the token was right.
  assert.equal(check({ host: ok.host, origin: 'https://evil.example', authorization: 'Bearer wrong' })?.status, 403);
});

test('the rate limiter allows `limit` requests per window', () => {
  let now = 0;
  const limiter = new RateLimiter(3, 1000, () => now);
  assert.deepEqual([limiter.take(), limiter.take(), limiter.take(), limiter.take()], [true, true, true, false]);
  now = 1000;
  assert.equal(limiter.take(), true);
});

const request = (chunks: string[], headers: Record<string, string> = {}) => Object.assign(Readable.from(chunks.map((c) => Buffer.from(c))), { headers }) as unknown as IncomingMessage;

test('the body is capped, by its declared length and by what actually arrives', async () => {
  assert.equal(await readBody(request(['{"a":', '1}']), 10), '{"a":1}');
  await assert.rejects(readBody(request(['x'], { 'content-length': '11' }), 10), BodyTooLarge);
  await assert.rejects(readBody(request(['123456', '78901']), 10), BodyTooLarge);
});

test('the writes need confirm repeating the slot, and their schema asks for it', () => {
  assert.equal(needsApproval('save_preset'), true);
  assert.equal(needsApproval('matribox_save_preset'), true);
  assert.equal(needsApproval('edit_preset'), false);
  assert.deepEqual(approvalFor('save_preset', { slot: 'p45', name: 'Black', confirm: 'P45' }), { tool: 'save_preset', what: 'save the current sound as "Black"', slot: 'P45' });
  assert.throws(() => approvalFor('save_preset', { slot: 'P45', name: 'Black' }), /confirm must repeat/);
  assert.throws(() => approvalFor('matribox_save_preset', { slot: '12A', name: 'X', confirm: '12B' }), /confirm must repeat/);
  assert.throws(() => approvalFor('edit_preset', {}), /does not store/);
  const [save, edit] = withConfirm([
    { name: 'save_preset', description: 'Saves.', inputSchema: { type: 'object', properties: { slot: {} }, required: ['slot'] } },
    { name: 'edit_preset', description: 'Edits.', inputSchema: { type: 'object', properties: {} } },
  ]);
  assert.deepEqual(save?.inputSchema.required, ['slot', 'confirm']);
  assert.ok(save?.inputSchema.properties?.confirm);
  assert.equal(edit?.inputSchema.properties?.confirm, undefined);
});

test('settings are off by default, keep the token across turning off and on, and are private to the user', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-ai-'));
  assert.deepEqual(loadAiSettings(dir), OFF);
  const on = enable(OFF);
  assert.equal(on.enabled, true);
  assert.match(on.token ?? '', /^[A-Za-z0-9_-]{43}$/);
  saveAiSettings(dir, on);
  assert.deepEqual(loadAiSettings(dir), on);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'ai-connection.json')).mode & 0o777, 0o600);
  const off = disable(on);
  saveAiSettings(dir, off);
  assert.deepEqual(loadAiSettings(dir), { enabled: false, token: on.token });
  assert.equal(enable(off).token, on.token);
  assert.notEqual(regenerate(on).token, on.token);
  // A file that is not ours turns it off.
  writeFileSync(join(dir, 'ai-connection.json'), JSON.stringify({ enabled: true, token: 'short' }));
  assert.deepEqual(loadAiSettings(dir), OFF);
  writeFileSync(join(dir, 'ai-connection.json'), 'not json');
  assert.deepEqual(loadAiSettings(dir), OFF);
  assert.ok(readFileSync(join(dir, 'ai-connection.json'), 'utf8'));
});
