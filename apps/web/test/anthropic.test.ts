import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePreset, applyEdit, type Edit, type Preset, type ToneHost } from '@pocket-master/core';
import { pocketMasterAgent } from '../lib/pocketAgent.ts';
import { realP08 } from '../../../packages/core/test/fake-pedal.ts';
import { converseClaude, listClaudeModels } from '../lib/anthropic.ts';
import { BusyError, KeyError, QuotaError, StepLimitError, ToolLoopError } from '../lib/assistant.ts';

const KEY = 'fake-anthropic-key-unit-0000';
const SLOTS = { irNames: [null, null, null, null, null], profileNames: [null, null, null, null, null] };

function host() {
  let preset: Preset = decodePreset(realP08());
  const edits: Edit[][] = [];
  const h: ToneHost = {
    snapshot: () => ({ index: 7, name: 'IRON-RHY', preset, slots: SLOTS, modified: edits.length > 0, names: [] }),
    applyEdits: async (e) => {
      edits.push([...e]);
      preset = e.reduce(applyEdit, preset);
    },
    undo: async () => false,
    revert: async () => undefined,
    selectPreset: async () => true,
    proposeSave: async () => 'saved',
  };
  return { h, edits };
}

function scripted(...replies: { status?: number; body: unknown; headers?: Record<string, string> }[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} });
    const r = replies.shift();
    if (!r) throw new Error('no more scripted replies');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

const toolUse = (name: string, input: unknown, id = 'tu_1') => ({
  body: {
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: 'Setting it up.' },
      { type: 'tool_use', id, name, input },
    ],
  },
});
const say = (text: string) => ({ body: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const options = (h: ToneHost, fetchFn: typeof fetch) => ({ key: KEY, model: 'anthropic' as const, turns: [], message: 'black album', agent: pocketMasterAgent(h), fetchFn, onRequest: () => {} });

test('a tone through Claude: tool use, then the answer; the key only in x-api-key, with the browser header', async () => {
  const { h, edits } = host();
  const { fetchFn, requests } = scripted(toolUse('edit_preset', { changes: [{ kind: 'model', block: 'amp', model: 'Calif DualM' }] }), say('Mesa Dual Rectifier.'));
  const reply = await converseClaude('claude-test-haiku', options(h, fetchFn));
  assert.equal(reply, 'Mesa Dual Rectifier.');
  assert.equal(edits.length, 1);
  const [first, second] = requests;
  assert.equal(first!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(first!.headers['x-api-key'], KEY);
  assert.equal(first!.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(first!.headers['anthropic-version'], '2023-06-01');
  assert.equal(first!.body.model, 'claude-test-haiku');
  assert.ok(Number(first!.body.max_tokens) > 0);
  assert.ok(Array.isArray(first!.body.tools) && (first!.body.tools as { input_schema?: unknown }[]).every((t) => t.input_schema));
  const msgs = second!.body.messages as { role: string; content: unknown }[];
  assert.equal(msgs.at(-2)!.role, 'assistant');
  assert.deepEqual(
    (msgs.at(-1)!.content as { type: string; tool_use_id: string }[]).map((c) => [c.type, c.tool_use_id]),
    [['tool_result', 'tu_1']],
  );
  assert.doesNotMatch(JSON.stringify(second!.body.messages), /AMP models:/, 'model list only in the first request');
});

test('a reply with a signed thinking block keeps the message it was made for (no 400 "Invalid signature")', async () => {
  const { h } = host();
  const thought = { type: 'thinking', thinking: 'Plexi for brown sound.', signature: 'sig-bound-to-first' };
  const reply = toolUse('edit_preset', { changes: [{ kind: 'model', block: 'amp', model: 'Calif DualM' }] });
  reply.body.content = [thought, ...reply.body.content] as typeof reply.body.content;
  const { fetchFn, requests } = scripted(reply, say('Done.'));
  await converseClaude('claude-test-fable', options(h, fetchFn));
  const [first, second] = requests;
  const firstMsgs = first!.body.messages as unknown[];
  const secondMsgs = second!.body.messages as { content: unknown }[];
  assert.deepEqual(secondMsgs[0], firstMsgs[0], 'the user message the thinking was signed against is sent unchanged');
  assert.deepEqual((secondMsgs[1]!.content as unknown[])[0], thought, 'the thinking block goes back as it came');
});

test("Claude errors become the router's: 401 key, 429 quota with retry-after, 529 busy", async () => {
  const { h } = host();
  const now = new Date('2026-11-22T20:00:00Z');
  const run = (r: { status: number; body: unknown; headers?: Record<string, string> }) => converseClaude('m', { ...options(h, scripted(r).fetchFn), now: () => now }).catch((x) => x);
  const key = await run({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  assert.ok(key instanceof KeyError);
  assert.equal(key.provider, 'anthropic');
  const quota = await run({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, headers: { 'retry-after': '120' } });
  assert.ok(quota instanceof QuotaError);
  assert.equal(quota.retryAt.toISOString(), '2026-11-22T20:02:00.000Z');
  assert.ok((await run({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } })) instanceof BusyError);
  assert.match((await run({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad model' } } })).message, /Claude answered 400: bad model/);
});

test('the Claude model list checks the key and lists the model ids', async () => {
  const ok = scripted({ body: { data: [{ id: 'claude-test-sonnet' }, { id: 'claude-test-haiku' }] } });
  assert.deepEqual(await listClaudeModels(KEY, ok.fetchFn), ['claude-test-sonnet', 'claude-test-haiku']);
  assert.equal(ok.requests[0]!.url, 'https://api.anthropic.com/v1/models');
  assert.equal(ok.requests[0]!.headers['x-api-key'], KEY);
  assert.equal(await listClaudeModels(KEY, scripted({ status: 401, body: {} }).fetchFn), 'invalid');
  assert.equal(await listClaudeModels(KEY, scripted({ status: 500, body: {} }).fetchFn), 'unavailable');
});

test('Claude caches the system prompt, tools and the first prompt (the model list), so later requests read them at a tenth of the price', async () => {
  const { h } = host();
  const { fetchFn, requests } = scripted(toolUse('edit_preset', { changes: [{ kind: 'model', block: 'amp', model: 'Calif DualM' }] }), say('ok'));
  await converseClaude('m', options(h, fetchFn));
  for (const r of requests) {
    const system = r.body.system as { type: string; cache_control?: unknown }[];
    assert.deepEqual(system.at(-1)!.cache_control, { type: 'ephemeral' }, 'system prompt (and tools before it) cached');
  }
  const first = (requests[0]!.body.messages as { content: { cache_control?: unknown }[] }[]).at(-1)!.content;
  assert.deepEqual(first.at(-1)!.cache_control, { type: 'ephemeral' }, 'first prompt cached');
});

test('cached input counts toward the cost at its own price (writes 1.25x, reads 0.1x)', async () => {
  const { h } = host();
  const usage: [number, number][] = [];
  const reply = {
    body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 100, cache_creation_input_tokens: 4000, cache_read_input_tokens: 10000, output_tokens: 300 } },
  };
  await converseClaude('m', { ...options(h, scripted(reply).fetchFn), onUsage: (i, o) => usage.push([i, o]) });
  assert.deepEqual(usage, [[100 + 5000 + 1000, 300]]);
});

test("Claude reports each request's token usage", async () => {
  const { h } = host();
  const usage: [number, number][] = [];
  const reply = { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 4000, output_tokens: 300 } } };
  await converseClaude('m', { ...options(h, scripted(reply).fetchFn), onUsage: (i, o) => usage.push([i, o]) });
  assert.deepEqual(usage, [[4000, 300]]);
});

test('the same tool failing twice in one message stops it at once, naming the tool and why (no step budget burnt)', async () => {
  const { h } = host();
  const broken: ToneHost = { ...h, applyEdits: async () => Promise.reject(new Error('Matribox II PRO did not confirm the write')) };
  const change = { changes: [{ kind: 'model', block: 'amp', model: 'Calif DualM' }] };
  const { fetchFn, requests } = scripted(toolUse('edit_preset', change, 'a'), toolUse('edit_preset', change, 'b'), toolUse('edit_preset', change, 'c'), say('never'));
  await assert.rejects(converseClaude('claude-test-haiku', options(broken, fetchFn)), (e: unknown) => {
    assert.ok(e instanceof ToolLoopError);
    assert.equal(e.tool, 'edit_preset');
    assert.match(e.reason, /did not confirm the write/);
    return true;
  });
  assert.equal(requests.length, 2);
});

test('the step limit is its own error, so the panel can say what to do', async () => {
  const { h } = host();
  const { fetchFn } = scripted(...Array.from({ length: 8 }, (_, i) => toolUse('get_preset', {}, `g${i}`)));
  await assert.rejects(converseClaude('claude-test-haiku', options(h, fetchFn)), StepLimitError);
});
