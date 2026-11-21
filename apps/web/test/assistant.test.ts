import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, KeyError, QuotaError, ROUTE, type AiModel, type Converse } from '../lib/assistant.ts';
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
