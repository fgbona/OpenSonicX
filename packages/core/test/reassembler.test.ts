import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame, buildFrame } from '../src/frame.ts';
import { Reassembler } from '../src/reassembler.ts';
import { Query, queryFrame, isReadOnly, isReply } from '../src/queries.ts';
import { toHex } from '../src/hex.ts';
import { readCapture } from './capture.ts';

const capture = readCapture('p08-capture.txt');
const dumpFrames = capture.filter((m) => m.dir === 'RX').slice(1).map((m) => parseFrame(m.bytes));

test('capture holds 26 dump packets', () => {
  assert.equal(dumpFrames.length, 26);
  assert.ok(dumpFrames.every((f) => f.crcOk && f.total === 26));
});

test('reassembler joins the 26 dump packets into one 476-byte payload', () => {
  const r = new Reassembler();
  const out = dumpFrames.map((f) => r.feed(f, 0));
  assert.ok(out.slice(0, 25).every((x) => x === null));
  const joined = out[25];
  assert.ok(joined);
  assert.equal(joined.payload.length, 476);
  assert.equal(toHex(joined.payload.subarray(0, 2)), '12 41');
  assert.equal(joined.crcOk, true);
});

test('reassembler drops incomplete sets', () => {
  const r = new Reassembler();
  const missing = dumpFrames.filter((f) => f.index !== 12);
  assert.ok(missing.every((f) => r.feed(f, 0) === null));
  // a new packet 0 restarts the set: packet 12 alone must not complete it
  assert.equal(r.feed(dumpFrames[0]!, 10), null);
  assert.equal(r.feed(dumpFrames[12]!, 10), null);
});

test('reassembler discards a stale partial set', () => {
  const r = new Reassembler();
  dumpFrames.slice(0, 25).forEach((f) => r.feed(f, 0));
  assert.equal(r.feed(dumpFrames[25]!, 5000), null);
});

test('reassembler passes single-packet frames through', () => {
  const f = parseFrame(capture[1]!.bytes);
  assert.equal(new Reassembler().feed(f, 0), f);
});

test('queryFrame matches captured queries', () => {
  assert.equal(toHex(queryFrame(Query.CURRENT_PRESET)), toHex(capture[0]!.bytes));
  assert.equal(toHex(queryFrame(Query.EDIT_BUFFER)), toHex(capture[2]!.bytes));
});

test('isReadOnly accepts queries and rejects set commands', () => {
  assert.equal(isReadOnly(queryFrame(Query.EDIT_BUFFER)), true);
  assert.equal(isReadOnly(buildFrame([0x11, 0x48, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x48, 0x42])), false);
  assert.equal(isReadOnly(buildFrame([0x11, 0x4a, 0, 0, 0, 0])), false);
  assert.equal(isReadOnly(Uint8Array.from([0xf0, 0x7f, 0xf7])), false);
});

test('isReply matches on type and command', () => {
  const reply = parseFrame(capture[1]!.bytes);
  assert.equal(isReply(reply, Query.CURRENT_PRESET), true);
  assert.equal(isReply(reply, Query.EDIT_BUFFER), false);
});

test('reassembler ignores a packet whose index is outside its set', () => {
  const r = new Reassembler();
  // Packets 1..25 plus a bogus index 26 would reach 26 parts with packet 0 missing.
  dumpFrames.slice(1).forEach((f) => r.feed(f, 0));
  assert.equal(r.feed({ ...dumpFrames[1]!, index: 26 }, 0), null);
  assert.equal(r.feed(dumpFrames[0]!, 0), null, 'packet 0 starts a fresh set');
});
