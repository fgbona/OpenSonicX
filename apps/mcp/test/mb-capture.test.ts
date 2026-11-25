import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMbFrames, float32LE, MB_REPLY, MB_WRITE, type MbMessage, wrapMbMessage } from '@pocket-master/core';
import { type Decoded, decodeEvents, diffTables, formatDiff, globalTables, unitNotices, writeRuns } from '../scripts/mb-capture.ts';

const msg = (flag: number, cmd: number, data: number[]): MbMessage => ({ flag, cmd, data: Uint8Array.from(data) });
const unit = (m: MbMessage): Decoded => ({ t: 0, dir: 'From', type: MB_REPLY, message: m });
const host = (m: MbMessage): Decoded => ({ t: 0, dir: 'To', type: MB_WRITE, message: m });

test('diffTables lists changed bytes and the float32 words that hold them', () => {
  const before = Uint8Array.from([...float32LE(0), ...float32LE(500), 7, 7]);
  const after = Uint8Array.from([...float32LE(0), ...float32LE(3), 7, 8]);
  const { bytes, words, lengths } = diffTables(before, after);
  assert.deepEqual(lengths, [10, 10]);
  assert.deepEqual(
    bytes.map((c) => c.at),
    [6, 7, 9],
  );
  // The changed float at 4 is reported; byte 9 sits in no whole word, so only as a byte.
  assert.deepEqual(
    words.map((w) => [w.at, w.before.f32, w.after.f32]),
    [[4, 500, 3]],
  );
  assert.deepEqual(diffTables(before, before).bytes, []);
  assert.match(formatDiff('k', before, before).join('\n'), /no change/);
  assert.match(formatDiff('k', before, after).join('\n'), /byte {3}9: 07 -> 08/);
});

test('globalTables keeps the unit replies to cmd 11, 13, 16 and not notices or host messages', () => {
  const decoded = [
    unit(msg(0, 0x11, [0, 0, 2])),
    unit(msg(1, 0x11, [0, 8, 0, 0, 1, 0, 0, 0])), // "preset edited" notice
    host(msg(0, 0x11, [])),
    unit(msg(0, 0x10, [1])),
    unit(msg(0, 0x11, [0, 0, 3])),
  ];
  const tables = globalTables(decoded);
  assert.deepEqual([...tables.keys()], ['flag 0 cmd 11 (3 B)']);
  assert.deepEqual(
    tables.get('flag 0 cmd 11 (3 B)')?.map((d) => d[2]),
    [2, 3],
  );
});

test('writeRuns groups a stream of writes of one kind', () => {
  const vol = (v: number) => host(msg(1, 0x10, [3, 0, 5, 1, v, 0, 0, 0]));
  const sel = host(msg(1, 0x10, [1, 0, 0x0a, 1, 9, 0, 0, 0]));
  assert.deepEqual(
    writeRuns([vol(1), vol(2), vol(3), sel, vol(4)]).map((r) => r.length),
    [3, 1, 1],
  );
});

test('unitNotices drops replies and echoes, keeps what the unit sent on its own', () => {
  const select = msg(1, 0x10, [1, 0, 0x0a, 1, 5, 0, 0, 0]);
  const decoded = [host(select), unit(select), unit(msg(1, 0x11, [0, 8, 0, 0, 1, 0, 0, 0])), unit(select), unit(msg(0, 0x11, [0]))];
  assert.deepEqual(
    unitNotices(decoded).map((d) => d.message?.cmd),
    [0x11, 0x10],
  );
});

test('decodeEvents joins paged frames and unwraps them', () => {
  const data = Array.from({ length: 400 }, (_, i) => i & 0xff);
  const frames = buildMbFrames(MB_WRITE, wrapMbMessage(2, 0x10, data));
  assert.ok(frames.length > 1);
  const decoded = decodeEvents(frames.map((bytes, i) => ({ t: i, dir: 'To' as const, bytes })));
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0]?.message?.cmd, 0x10);
  assert.deepEqual(Array.from(decoded[0]?.message?.data ?? []), data);
  assert.match(decodeEvents([{ t: 0, dir: 'From', bytes: Uint8Array.from([0xf0, 1, 0xf7]) }])[0]?.note ?? '', /not a frame/);
});
