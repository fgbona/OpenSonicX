import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { matriboxLink, MATRIBOX_FLUSH_MS } from '../src/matribox/link.ts';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { unwrapMbMessage, wrapMbMessage } from '../src/matribox/message.ts';
import type { MbNotice } from '../src/matribox/notice.ts';
import { replyFrames } from './fake-matribox.ts';

const HOLD_MS = 150;
const MAX_HELD = 10;
const word = (data: ArrayLike<number>) => Array.from(data).slice(0, 4).join(',');

/**
 * The stock firmware's notice queue (FUN_0003568C, as zxmarcos/waveod src/editor/server.c
 * reimplements it): the same notice again is held (the newest kept) until 150 ms pass without one
 * or 10 are held; any other notice sends the held one first. It answers the patch-volume read
 * through the same queue. `now` is the simulated clock.
 */
function holdingUnit(volume: number) {
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  let last = '';
  let held: number[] | null = null;
  let since = 0;
  let count = 0;
  let now = 0;
  const reads: number[] = [];
  const out = (data: number[]) => receiver?.(replyFrames(wrapMbMessage(1, 0x10, data))[0] as Uint8Array);
  const notify = (data: number[]) => {
    if (word(data) === last) {
      held = data;
      since = now;
      count++;
      return;
    }
    if (held) out(held);
    held = null;
    last = word(data);
    out(data);
    count = 0;
  };
  return {
    reads,
    port: {
      send: (bytes: Uint8Array) => {
        const { data } = unwrapMbMessage(parseMbFrame(bytes).payload);
        if (word(data) !== word([0x03, 0x00, 0x05, 0x01])) throw new Error('unexpected request');
        reads.push(now);
        notify([0x03, 0x00, 0x05, 0x01, volume, 0, 0, 0]);
      },
      listen: (r: ((bytes: Uint8Array) => void) | null) => {
        receiver = r;
      },
    },
    knob: (value: number) => notify([0x01, 0x00, 0x05, 0x01, 2, 0, 0, 0, 0, 0, 0, 0, ...new Uint8Array(Float32Array.of(value).buffer)]),
    /** The main loop's flush check, once a millisecond. */
    tick: (ms: number) => {
      now = ms;
      if (held && (now - since >= HOLD_MS || count >= MAX_HELD)) {
        out(held);
        held = null;
        count = 0;
      }
    },
  };
}

/** A knob turned one step every 20 ms for 1 s (values 1..50); how late the link hands each step on. */
function turn(t: TestContext, flushMs: number) {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const unit = holdingUnit(80);
  const link = matriboxLink(unit.port, 1000, flushMs);
  const seen: { at: number; value: number }[] = [];
  const volumes: number[] = [];
  let now = 0;
  link.onNotice((n: MbNotice) => {
    if (n.kind === 'param') seen.push({ at: now, value: n.value });
    if (n.kind === 'volume') volumes.push(n.value);
  });
  for (; now <= 3000; now++) {
    if (now < 1000 && now % 20 === 0) unit.knob(now / 20 + 1);
    unit.tick(now);
    mock.timers.tick(1);
  }
  const lateness = Array.from({ length: 50 }, (_, i) => (seen.find((s) => s.value >= i + 1)?.at ?? Infinity) - i * 20);
  return { worst: Math.max(...lateness), last: lateness[49] as number, reads: unit.reads, volumes, link };
}

test('without letting held notices out, a knob turned on the unit reaches the link late (mb-42: 0.4 s apart)', (t) => {
  const { worst, last, reads } = turn(t, 0);
  t.diagnostic(`no flush: worst ${worst} ms, last step ${last} ms`);
  assert.ok(worst >= HOLD_MS, `worst ${worst} ms`);
  assert.ok(last >= HOLD_MS - 1, `last ${last} ms`); // the step lands on the flush check
  assert.equal(reads.length, 0);
});

test('the link lets a held knob notice out every flush period, and stops once the knob stops', (t) => {
  const { worst, last, reads, volumes, link } = turn(t, MATRIBOX_FLUSH_MS);
  t.diagnostic(`flush every ${MATRIBOX_FLUSH_MS} ms: worst ${worst} ms, last step ${last} ms, ${reads.length} reads`);
  assert.ok(worst <= MATRIBOX_FLUSH_MS, `worst ${worst} ms`);
  assert.ok(last <= MATRIBOX_FLUSH_MS, `last ${last} ms`);
  // About 20 reads a second while it turns, then 10 quiet ones: nothing after 1.6 s.
  assert.ok(reads.length <= 1000 / MATRIBOX_FLUSH_MS + 12, `${reads.length} reads`);
  assert.ok((reads.at(-1) as number) < 1600, `last read at ${reads.at(-1)} ms`);
  assert.ok(volumes.every((v) => v === 80)); // the read's answer is the unit's own volume, handed on like its notice
  link.onNotice(null);
});
