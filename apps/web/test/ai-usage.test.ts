import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countRequest, nextReset, pacificDay, parseUsage, usedToday } from '../lib/aiUsage.ts';
import { maskKey } from '../lib/aiKey.ts';

test('the free quota day is the Pacific day', () => {
  assert.equal(pacificDay(new Date('2026-11-22T07:59:00Z')), '2026-11-21'); // 23:59 PST
  assert.equal(pacificDay(new Date('2026-11-22T08:00:00Z')), '2026-11-22');
  assert.equal(pacificDay(new Date('2026-07-01T06:59:00Z')), '2026-06-30'); // PDT
  assert.equal(pacificDay(new Date('2026-07-01T07:00:00Z')), '2026-07-01');
});

test('the quota resets at the next Pacific midnight', () => {
  assert.equal(nextReset(new Date('2026-11-21T20:00:00Z')).toISOString(), '2026-11-22T08:00:00.000Z');
  assert.equal(nextReset(new Date('2026-07-01T12:00:00Z')).toISOString(), '2026-07-02T07:00:00.000Z');
});

test('requests count per model and per day; an older day reads as zero', () => {
  const t1 = new Date('2026-11-21T20:00:00Z');
  let usage = countRequest({}, 'flash', t1);
  usage = countRequest(usage, 'flash', t1);
  usage = countRequest(usage, 'lite', t1);
  assert.equal(usedToday(usage, 'flash', t1), 2);
  assert.equal(usedToday(usage, 'lite', t1), 1);
  const nextDay = new Date('2026-11-22T09:00:00Z');
  assert.equal(usedToday(usage, 'flash', nextDay), 0);
  assert.equal(usedToday(countRequest(usage, 'flash', nextDay), 'flash', nextDay), 1);
});

test('stored usage is read defensively', () => {
  assert.deepEqual(parseUsage(null), {});
  assert.deepEqual(parseUsage('nope'), {});
  assert.deepEqual(parseUsage(JSON.stringify({ flash: { day: '2026-11-21', count: 3 }, bad: { day: 1 } })), { flash: { day: '2026-11-21', count: 3 } });
});

test('a key is never shown in full', () => {
  assert.equal(maskKey('AIzaSyD-1234567890abcdefghijklmnopqrstuv'), 'AIza…stuv');
  assert.equal(maskKey('short'), '••••');
});
