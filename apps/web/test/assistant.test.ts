import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, askedToSave, BUSY_WAIT_MS, BusyError, KeyError, post, QuotaError, ROUTE, type AiModel, type Converse } from '../lib/assistant.ts';
import type { ToneHost } from '@pocket-master/core';

const host = {} as ToneHost;
const now = new Date('2026-11-21T20:00:00Z');
const later = (min: number) => new Date(now.getTime() + min * 60_000);

/** Converse functions per model that answer or fail as scripted, recording who was asked. */
function models(script: Record<string, (() => string) | Error>) {
  const asked: string[] = [];
  const converse = Object.fromEntries(ROUTE.map((m) => [m, async () => {
    asked.push(m);
    const s = script[m];
    if (s instanceof Error) throw s;
    return s ? s() : `answer from ${m}`;
  }])) as unknown as Record<AiModel, Converse>;
  return { asked, converse };
}

const base = { turns: [], message: 'hi', host, onRequest: () => {}, now: () => now };

test('Groq answers first when it has a key, Gemini otherwise', async () => {
  const both = models({});
  const r = await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse: both.converse });
  assert.deepEqual([r.model, r.reply], ['groq', 'answer from groq']);
  const onlyGemini = models({});
  assert.equal((await ask({ ...base, keys: { gemini: 'k' }, cooldown: {}, converse: onlyGemini.converse })).model, 'flash');
  assert.deepEqual(onlyGemini.asked, ['flash']);
});

test('a used-up quota hands the message to the next model and remembers until when', async () => {
  const m = models({ groq: new QuotaError(later(30)), flash: new QuotaError(later(600)) });
  const r = await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse: m.converse });
  assert.equal(r.model, 'lite');
  assert.deepEqual(m.asked, ['groq', 'flash', 'lite']);
  assert.deepEqual(r.cooldown, { groq: later(30), flash: later(600) });
  // Next message: models still cooling down are skipped without a request.
  const next = models({});
  await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: r.cooldown, converse: next.converse });
  assert.deepEqual(next.asked, ['lite']);
});

test('when every model is used up, the error says when the first one comes back', async () => {
  const m = models({ groq: new QuotaError(later(30)), flash: new QuotaError(later(600)), lite: new QuotaError(later(5)) });
  const e = await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse: m.converse }).catch((x) => x);
  assert.ok(e instanceof QuotaError);
  assert.equal(e.retryAt.getTime(), later(5).getTime());
});

test('a refused key skips that provider; other errors stop at once', async () => {
  const m = models({ groq: new KeyError('groq', 'bad key') });
  const r = await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse: m.converse });
  assert.equal(r.model, 'flash');
  assert.deepEqual(r.badKeys, ['groq']);
  const onlyBad = await ask({ ...base, keys: { groq: 'g' }, cooldown: {}, converse: models({ groq: new KeyError('groq', 'bad') }).converse }).catch((x) => x);
  assert.ok(onlyBad instanceof KeyError);
  const broken = models({ groq: new Error('network down') });
  await assert.rejects(ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse: broken.converse }), /network down/);
  assert.deepEqual(broken.asked, ['groq']);
  await assert.rejects(ask({ ...base, keys: {}, cooldown: {}, converse: broken.converse }), /No AI key/);
});

test('a quota that runs out after the sound changed stops instead of repeating the request elsewhere', async () => {
  const asked: string[] = [];
  const converse = {
    groq: async (o: { onStep?: (t: string, ok: boolean, text: string) => void }) => {
      asked.push('groq');
      o.onStep?.('edit_preset', true, 'ok');
      throw new QuotaError(later(30));
    },
    flash: async () => { asked.push('flash'); return 'from flash'; },
    lite: async () => { asked.push('lite'); return 'from lite'; },
  } as unknown as Record<AiModel, Converse>;
  const seen: unknown[] = [];
  const e = await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse, onCooldown: (c) => seen.push(c) }).catch((x) => x);
  assert.ok(e instanceof QuotaError);
  assert.equal(e.partial, true);
  assert.equal(e.model, 'groq');
  assert.deepEqual(asked, ['groq'], 'Gemini is not asked to do it again');
  assert.deepEqual(seen, [{ groq: later(30) }], 'the pause is reported as soon as it is known');
});

test('a read-only step before the quota ran out still hands the message on', async () => {
  const converse = {
    groq: async (o: { onStep?: (t: string, ok: boolean, text: string) => void }) => { o.onStep?.('get_preset', true, 'P08'); o.onStep?.('edit_preset', false, 'Error'); throw new QuotaError(later(30)); },
    flash: async () => 'from flash',
    lite: async () => 'from lite',
  } as unknown as Record<AiModel, Converse>;
  assert.equal((await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse })).model, 'flash');
});

test('a busy model hands the message on; when all are busy or used up, the error says busy', async () => {
  const m = models({ flash: new BusyError(later(0.5)) });
  const r = await ask({ ...base, keys: { gemini: 'k' }, cooldown: {}, converse: m.converse });
  assert.equal(r.model, 'lite');
  const all = models({ groq: new QuotaError(later(30)), flash: new BusyError(later(0.5)), lite: new BusyError(later(0.5)) });
  const e = await ask({ ...base, keys: { groq: 'g', gemini: 'k' }, cooldown: {}, converse: all.converse }).catch((x) => x);
  assert.ok(e instanceof BusyError);
  assert.equal(e.retryAt.getTime(), later(0.5).getTime());
});

test('a model request that never answers gives up and counts as busy', async () => {
  const hanging = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  })) as unknown as typeof fetch;
  const e = await post(hanging, 'https://example.test', { method: 'POST' }, () => now, 20).catch((x) => x);
  assert.ok(e instanceof BusyError);
  assert.equal(e.retryAt.getTime(), now.getTime() + BUSY_WAIT_MS);
});

test('a model that gets busy after the sound changed stops and says the request is half done', async () => {
  const m = models({ flash: new BusyError(later(0.5)) });
  const acting: Converse = async (o) => { o.onStep?.('edit_preset', true, 'ok'); throw new BusyError(later(0.5)); };
  const e = await ask({ ...base, keys: { gemini: 'k' }, cooldown: {}, converse: { ...m.converse, flash: acting } }).catch((x) => x);
  assert.ok(e instanceof BusyError);
  assert.equal(e.partial, true);
  assert.equal(e.model, 'flash');
});

test('a request to save names a user slot, in Portuguese or English; otherwise none', () => {
  assert.equal(askedToSave('timbre do black album do metallica e salve no p47'), 46);
  assert.equal(askedToSave('salve no preset 44 o timbre de base do dream theater'), 43);
  assert.equal(askedToSave('grave no 38 o clean do Queensrÿche'), 37);
  assert.equal(askedToSave('save it to P45, please'), 44);
  assert.equal(askedToSave('store this in slot 9'), 8);
  assert.equal(askedToSave('o preset 40 está grave demais'), null, 'no save verb');
  assert.equal(askedToSave('salve no preset 51'), null, 'not a user slot');
  assert.equal(askedToSave('salve isso'), null, 'no slot');
});

test('a route with a paid provider tries it before the free models', async () => {
  const m = models({});
  const converse = { ...m.converse, openai: async () => 'answer from openai' } as Record<AiModel, Converse>;
  const r = await ask({ ...base, keys: { openai: 'k', groq: 'g' }, cooldown: {}, converse, route: ['openai', ...ROUTE] });
  assert.deepEqual([r.model, r.reply], ['openai', 'answer from openai']);
});
