import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePreset, applyEdit, type Edit, type Preset, type ToneHost } from '@pocket-master/core';
import { realP08 } from '../../../packages/core/test/fake-pedal.ts';
import { converseGroq, GROQ_MODEL, testGroqKey } from '../lib/groq.ts';
import { KeyError, QuotaError } from '../lib/assistant.ts';

const KEY = 'gsk_TESTKEY000000000000000000000000000000';
const SLOTS = { irNames: [null, null, null, null, null], profileNames: [null, null, null, null, null] };

function host() {
  let preset: Preset = decodePreset(realP08());
  const edits: Edit[][] = [];
  const h: ToneHost = {
    snapshot: () => ({ index: 7, name: 'IRON-RHY', preset, slots: SLOTS, modified: edits.length > 0, names: [] }),
    applyEdits: async (e) => { edits.push([...e]); preset = e.reduce(applyEdit, preset); },
    undo: async () => false, revert: async () => undefined, selectPreset: async () => true, proposeSave: async () => 'saved',
  };
  return { h, edits };
}

function scripted(...replies: { status?: number; body: unknown; headers?: Record<string, string> }[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} });
    const r = replies.shift();
    if (!r) throw new Error('no more scripted replies');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

const toolCall = (name: string, args: unknown, id = 'call_1') => ({ body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] } });
const say = (text: string, headers?: Record<string, string>) => ({ body: { choices: [{ message: { role: 'assistant', content: text } }] }, headers });

test('a tone through Groq: the model edits, then answers; the key only in the Authorization header', async () => {
  const { h, edits } = host();
  const { fetchFn, requests } = scripted(
    toolCall('edit_preset', { changes: [{ kind: 'model', block: 'amp', model: 'Calif DualM' }] }),
    say('Mesa Dual Rectifier.', { 'x-ratelimit-remaining-requests': '997', 'x-ratelimit-limit-requests': '1000' }),
  );
  const limits: number[][] = [];
  const reply = await converseGroq({ key: KEY, model: 'groq', turns: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello' }], message: 'black album', host: h, fetchFn, onRequest: () => {}, onLimits: (r, l) => limits.push([r, l]) });
  assert.equal(reply, 'Mesa Dual Rectifier.');
  assert.equal(edits.length, 1);
  assert.deepEqual(limits, [[997, 1000]]);
  for (const q of requests) {
    assert.equal(q.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(q.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(q.body.model, GROQ_MODEL.id);
  }
  const messages = requests[1]!.body.messages as { role: string; content?: string; tool_call_id?: string }[];
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'tool']);
  assert.match(messages[3]!.content!, /^Loaded preset now:\n/);
  assert.equal(messages[5]!.tool_call_id, 'call_1');
});

test('arguments that are not JSON come back to the model as an error, not a crash', async () => {
  const { h, edits } = host();
  const bad = { body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'edit_preset', arguments: '{oops' } }] } }] } };
  const { fetchFn, requests } = scripted(bad, say('Sorry.'));
  await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn, onRequest: () => {} });
  assert.equal(edits.length, 0);
  assert.match(JSON.stringify(requests[1]!.body.messages), /Error: changes must be a list/);
});

test('429 and a refused key are told apart, with when the quota comes back', async () => {
  const { h } = host();
  const now = new Date('2026-11-21T20:00:00Z');
  const quota = { status: 429, body: { error: { message: 'Rate limit reached for requests per day (RPD)' } }, headers: { 'retry-after': '120' } };
  const e = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn: scripted(quota).fetchFn, onRequest: () => {}, now: () => now }).catch((x) => x);
  assert.ok(e instanceof QuotaError);
  assert.equal(e.retryAt.toISOString(), '2026-11-21T20:02:00.000Z');
  const noHeader = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn: scripted({ status: 429, body: {} }).fetchFn, onRequest: () => {}, now: () => now }).catch((x) => x);
  assert.equal(noHeader.retryAt.toISOString(), '2026-11-21T20:01:00.000Z', 'a minute when Groq does not say');
  const bad = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn: scripted({ status: 401, body: { error: { message: 'Invalid API Key' } } }).fetchFn, onRequest: () => {} }).catch((x) => x);
  assert.ok(bad instanceof KeyError);
  assert.equal(bad.provider, 'groq');
});

test('testGroqKey asks for the model list', async () => {
  const ok = scripted({ body: { data: [] } });
  assert.equal(await testGroqKey(KEY, ok.fetchFn), 'ok');
  assert.equal(ok.requests[0]!.url, 'https://api.groq.com/openai/v1/models');
  assert.equal(await testGroqKey(KEY, scripted({ status: 401, body: {} }).fetchFn), 'invalid');
  assert.equal(await testGroqKey(KEY, scripted({ status: 503, body: {} }).fetchFn), 'unavailable');
});

test('a 429 without retry-after waits for the reset Groq states, or longer for a daily limit', async () => {
  const { h } = host();
  const now = new Date('2026-11-21T20:00:00Z');
  const run = (r: { status: number; body: unknown; headers?: Record<string, string> }) =>
    converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn: scripted(r).fetchFn, onRequest: () => {}, now: () => now }).then(() => { throw new Error('expected a quota error'); }, (x) => x as QuotaError);
  assert.equal((await run({ status: 429, body: {}, headers: { 'x-ratelimit-reset-requests': '2h3m4.5s' } })).retryAt.toISOString(), '2026-11-21T22:03:04.500Z');
  assert.equal((await run({ status: 429, body: { error: { message: 'Rate limit reached ... on requests per day (RPD): Limit 1000' } } })).retryAt.toISOString(), '2026-11-21T21:00:00.000Z', 'an hour for a daily limit');
  assert.equal((await run({ status: 429, body: {} })).retryAt.toISOString(), '2026-11-21T20:01:00.000Z');
});

test('a malformed tool call from the model (400 tool_use_failed) is retried once', async () => {
  const { h } = host();
  const failed = { status: 400, body: { error: { message: 'Failed to call a function', code: 'tool_use_failed' } } };
  const ok = scripted(failed, say('Done.'));
  assert.equal(await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn: ok.fetchFn, onRequest: () => {} }), 'Done.');
  assert.equal(ok.requests.length, 2);
  const twice = scripted(failed, failed);
  await assert.rejects(converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', host: h, fetchFn: twice.fetchFn, onRequest: () => {} }), /Groq answered 400/);
});
