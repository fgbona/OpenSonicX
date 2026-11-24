import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePreset, applyEdit, type Edit, type Preset, type ToneHost } from '@pocket-master/core';
import { pocketMasterAgent } from '../lib/pocketAgent.ts';
import { realP08 } from '../../../packages/core/test/fake-pedal.ts';
import { converseGroq, GROQ_MODEL, testGroqKey } from '../lib/groq.ts';
import { converseChat } from '../lib/openai-compat.ts';
import { BusyError, KeyError, QuotaError } from '../lib/assistant.ts';

const KEY = 'fake-groq-key-unit-0000';
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
  const reply = await converseGroq({ key: KEY, model: 'groq', turns: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello' }], message: 'black album', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {}, onLimits: (r, l) => limits.push([r, l]) });
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
  await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {} });
  assert.equal(edits.length, 0);
  assert.match(JSON.stringify(requests[1]!.body.messages), /Error: changes must be a list/);
});

test('429 and a refused key are told apart, with when the quota comes back', async () => {
  const { h } = host();
  const now = new Date('2026-11-21T20:00:00Z');
  const quota = { status: 429, body: { error: { message: 'Rate limit reached for requests per day (RPD)' } }, headers: { 'retry-after': '120' } };
  const e = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: scripted(quota).fetchFn, onRequest: () => {}, now: () => now }).catch((x) => x);
  assert.ok(e instanceof QuotaError);
  assert.equal(e.retryAt.toISOString(), '2026-11-21T20:02:00.000Z');
  // A minute when Groq does not say; that is short enough to wait out twice before giving up.
  const minute = { status: 429, body: {} };
  const noHeader = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: scripted(minute, minute, minute).fetchFn, onRequest: () => {}, now: () => now, wait: async () => {} }).catch((x) => x);
  assert.equal(noHeader.retryAt.toISOString(), '2026-11-21T20:01:00.000Z', 'a minute when Groq does not say');
  const bad = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: scripted({ status: 401, body: { error: { message: 'Invalid API Key' } } }).fetchFn, onRequest: () => {} }).catch((x) => x);
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
    converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: scripted(r, r, r).fetchFn, onRequest: () => {}, now: () => now, wait: async () => {} }).then(() => { throw new Error('expected a quota error'); }, (x) => x as QuotaError);
  assert.equal((await run({ status: 429, body: {}, headers: { 'x-ratelimit-reset-requests': '2h3m4.5s' } })).retryAt.toISOString(), '2026-11-21T22:03:04.500Z');
  assert.equal((await run({ status: 429, body: { error: { message: 'Rate limit reached ... on requests per day (RPD): Limit 1000' } } })).retryAt.toISOString(), '2026-11-21T21:00:00.000Z', 'an hour for a daily limit');
  assert.equal((await run({ status: 429, body: {} })).retryAt.toISOString(), '2026-11-21T20:01:00.000Z');
});

test('a malformed tool call from the model (400 tool_use_failed) is retried once', async () => {
  const { h } = host();
  const failed = { status: 400, body: { error: { message: 'Failed to call a function', code: 'tool_use_failed' } } };
  const ok = scripted(failed, say('Done.'));
  assert.equal(await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: ok.fetchFn, onRequest: () => {} }), 'Done.');
  assert.equal(ok.requests.length, 2);
  const twice = scripted(failed, failed);
  await assert.rejects(converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: twice.fetchFn, onRequest: () => {} }), /Groq answered 400/);
});

test('a 403 is not a wrong key: Groq\'s own reason is shown', async () => {
  const { h } = host();
  const denied = { status: 403, body: { error: { message: 'Access denied. Please check your network settings.' } } };
  const e = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: scripted(denied).fetchFn, onRequest: () => {} }).catch((x) => x);
  assert.ok(!(e instanceof KeyError));
  assert.match(e.message, /Groq answered 403: Access denied/);
});

test('an overloaded Groq pauses for half a minute so the next model answers', async () => {
  const { h } = host();
  const now = new Date('2026-11-21T20:00:00Z');
  const e = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: scripted({ status: 503, body: { error: { message: 'Service Unavailable' } } }).fetchFn, onRequest: () => {}, now: () => now }).catch((x) => x);
  assert.ok(e instanceof BusyError);
  assert.equal(e.retryAt.toISOString(), '2026-11-21T20:00:30.000Z');
});

test('the request names the language to answer in, the one the editor is shown in', async () => {
  const { h } = host();
  const { fetchFn, requests } = scripted(say('Pronto.'));
  await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'black album', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {}, language: 'Brazilian Portuguese' });
  const user = (requests[0]!.body.messages as { role: string; content: string }[]).at(-1)!;
  assert.match(user.content, /Request: black album\n\nAnswer in Brazilian Portuguese\.$/);
});

test('a short per-minute limit is waited out and the same request sent again', async () => {
  const { h } = host();
  const waits: number[] = [];
  const { fetchFn, requests } = scripted({ status: 429, body: { error: { message: 'Rate limit reached on tokens per minute (TPM)' } }, headers: { 'retry-after': '7' } }, say('Pronto.'));
  const reply = await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {}, wait: async (ms) => { waits.push(ms); } });
  assert.equal(reply, 'Pronto.');
  assert.deepEqual(waits, [7000]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.body.max_completion_tokens, GROQ_MODEL.maxCompletionTokens);
});

test('only the first request of a message carries the model list; later ones keep the preset and the request', async () => {
  const { h } = host();
  const { fetchFn, requests } = scripted(toolCall('edit_preset', { changes: [{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }] }), say('Done.'));
  await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'black album', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {} });
  const user = (i: number) => (requests[i]!.body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')!.content;
  assert.match(user(0), /AMP models:/);
  assert.doesNotMatch(user(1), /AMP models:/);
  assert.match(user(1), /Loaded preset:[\s\S]*Request: black album/);
});

test('free requests stay compact; a paid (thorough) request carries full descriptions and the longer instruction', async () => {
  const { h } = host();
  const free = scripted(say('ok'));
  await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: free.fetchFn, onRequest: () => {} });
  const paid = scripted(say('ok'));
  await converseChat({ provider: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1', model: 'm' }, { key: KEY, model: 'openai', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn: paid.fetchFn, onRequest: () => {}, thorough: true });
  const messages = (r: { body: Record<string, unknown> }) => r.body.messages as { role: string; content: string }[];
  const [freeSystem, freeUser] = messages(free.requests[0]!);
  const [paidSystem, paidUser] = messages(paid.requests[0]!);
  assert.doesNotMatch(freeSystem!.content, /actual rig/);
  assert.match(paidSystem!.content, /actual rig/);
  assert.doesNotMatch(freeUser!.content, /Chorus with depth, rate and tone/);
  assert.match(paidUser!.content, /Chorus with depth, rate and tone/);
});

test('each request\'s token usage is reported, with the provider\'s own cost when it sends one', async () => {
  const { h } = host();
  const usage: [number, number, number | undefined][] = [];
  const withUsage = (r: { body: Record<string, unknown> }, u: Record<string, number>) => ({ ...r, body: { ...r.body, usage: u } });
  const { fetchFn } = scripted(withUsage(toolCall('get_preset', {}), { prompt_tokens: 3000, completion_tokens: 100 }), withUsage(say('ok'), { prompt_tokens: 3200, completion_tokens: 50, cost: 0.0009 }));
  await converseGroq({ key: KEY, model: 'groq', turns: [], message: 'x', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {}, onUsage: (i, o, c) => usage.push([i, o, c]) });
  assert.deepEqual(usage, [[3000, 100, undefined], [3200, 50, 0.0009]]);
});
