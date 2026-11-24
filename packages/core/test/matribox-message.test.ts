import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mbReadCloneNames,
  mbReadCurrentPresetNumber,
  mbReadIrNames,
  mbReadPreset,
  mbReadPresetNames,
  parseMbCurrentPresetNumber,
  mbRequest,
  parseMbCloneNames,
  parseMbIrNames,
  parseMbPresetNames,
  unwrapMbMessage,
  wrapMbMessage,
} from '../src/matribox/message.ts';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { fromHex, toHex } from '../src/hex.ts';

const lines = readFileSync(new URL('./fixtures/matribox-reads.txt', import.meta.url), 'utf8').split('\n');
const REQUESTS = lines.filter((l) => l.startsWith('>>')).map((l) => fromHex(l.slice(3)));
/** The reply payload that follows a request in the fixture (joined pages). */
const replyTo = (request: Uint8Array): Uint8Array => {
  const at = lines.findIndex((l) => l === `>> ${Buffer.from(request).toString('hex')}`);
  const next = lines[at + 1] ?? '';
  assert.ok(at >= 0 && next.startsWith('<<'), 'reply kept in the fixture');
  return fromHex(next.slice(3));
};

// [flag, cmd, argument] of each read the official editor sends on connect, in order.
const CAPTURED_READS: readonly [number, number, number[] | undefined][] = [
  [1, 0x10, [0x00, 0x00, 0x0a, 0x01]], // preset list
  [1, 0x10, [0x01, 0x00, 0x0a, 0x01]], // current preset number
  [0, 0x10, [0x43, 0x00, 0x00, 0x00]], // preset data
  [1, 0x11, [0x00, 0x08, 0x00, 0x00]],
  [0, 0x14, undefined], // user IR names
  [0, 0x18, undefined], // capture (clone) names
  [0, 0x11, undefined],
  [0, 0x13, undefined],
  [0, 0x16, undefined],
  [1, 0x16, [0x01, 0x00, 0x00, 0x16]],
  [0, 0x10, [0x42, 0x00, 0x00, 0x00]], // preset data again (the current preset)
];

test('mbRequest rebuilds every captured read request byte for byte', () => {
  assert.equal(REQUESTS.length, CAPTURED_READS.length);
  CAPTURED_READS.forEach(([flag, cmd, arg], i) => {
    assert.equal(toHex(mbRequest(flag, cmd, arg)), toHex(REQUESTS[i] as Uint8Array), `request ${i}`);
  });
});

test('the named read builders are the captured requests', () => {
  assert.equal(toHex(mbReadPresetNames()), toHex(REQUESTS[0] as Uint8Array));
  assert.equal(toHex(mbReadIrNames()), toHex(REQUESTS[4] as Uint8Array));
  assert.equal(toHex(mbReadCloneNames()), toHex(REQUESTS[5] as Uint8Array));
});

test('the preset read builders are the captured requests', () => {
  assert.equal(toHex(mbReadCurrentPresetNumber()), toHex(REQUESTS[1] as Uint8Array));
  assert.equal(toHex(mbReadPreset(0x43)), toHex(REQUESTS[2] as Uint8Array));
  assert.equal(toHex(mbReadPreset(0x42)), toHex(REQUESTS[10] as Uint8Array));
  assert.throws(() => mbReadPreset(240), /0\.\.239/);
});

test('parseMbCurrentPresetNumber reads the real reply: preset 66', () => {
  assert.equal(parseMbCurrentPresetNumber(unwrapMbMessage(replyTo(REQUESTS[1] as Uint8Array)).data), 66);
  assert.throws(() => parseMbCurrentPresetNumber(fromHex('01 00 0A 01')), /8 bytes/);
  assert.throws(() => parseMbCurrentPresetNumber(fromHex('00 00 0A 01 42 00 00 00')), /01 00 0A 01/);
  assert.throws(() => parseMbCurrentPresetNumber(fromHex('01 00 0A 01 F0 00 00 00')), /240/);
});

test('a request payload is itself a message: header plus a literal-only LZO1X stream', () => {
  const payload = parseMbFrame(mbReadPresetNames()).payload;
  assert.equal(toHex(payload), '01 00 00 10 08 00 00 00 15 00 00 0A 01 11 00 00');
  assert.deepEqual(unwrapMbMessage(payload), { flag: 1, cmd: 0x10, data: fromHex('00 00 0A 01') });
  assert.deepEqual(unwrapMbMessage(parseMbFrame(mbReadIrNames()).payload), { flag: 0, cmd: 0x14, data: new Uint8Array(0) });
});

test('wrapMbMessage validates its fields', () => {
  assert.throws(() => wrapMbMessage(256, 0x10, []), /flag/);
  assert.throws(() => wrapMbMessage(0, -1, []), /cmd/);
});

test('unwraps a small 20-byte reply: it is compressed too', () => {
  const msg = unwrapMbMessage(replyTo(REQUESTS[1] as Uint8Array));
  assert.equal(msg.flag, 1);
  assert.equal(msg.cmd, 0x10);
  assert.equal(toHex(msg.data), '01 00 0A 01 42 00 00 00'); // current preset: 0x42 = 66
});

test('unwrapMbMessage rejects a bad header or a length that does not match', () => {
  const good = replyTo(REQUESTS[1] as Uint8Array);
  assert.throws(() => unwrapMbMessage(good.subarray(0, 7)), /8-byte header/);
  assert.throws(() => unwrapMbMessage(good.subarray(0, -1)), /length/);
  const badZero = Uint8Array.from(good);
  badZero[1] = 1;
  assert.throws(() => unwrapMbMessage(badZero), /header/);
  const badStream = Uint8Array.from(good);
  badStream[8] = 0x30;
  assert.throws(() => unwrapMbMessage(badStream), /LZO1X/);
});

test('parseMbPresetNames reads the 240 preset records of the real preset list', () => {
  const msg = unwrapMbMessage(replyTo(REQUESTS[0] as Uint8Array));
  assert.equal(msg.data.length, 7444);
  const presets = parseMbPresetNames(msg.data);
  assert.equal(presets.length, 240);
  assert.deepEqual(presets[1], { name: 'Love of God', style: 'Rock' });
  assert.deepEqual(presets[2], { name: 'Heavy Metal', style: 'Metal' });
  assert.equal(presets[66]?.name, 'Drive AD'); // the current preset, number 66
  assert.equal(presets[136]?.name, 'FDR TS OCD CH');
  assert.equal(presets[136]?.style, '@lex');
  assert.equal(presets[142]?.name, '7 CORDAS');
  assert.equal(presets[0]?.name, 'Matribox II PRO');
  assert.equal(presets[239]?.style, '');
});

test('names end at the first NUL; stale bytes after it are ignored', () => {
  const presets = parseMbPresetNames(unwrapMbMessage(replyTo(REQUESTS[0] as Uint8Array)).data);
  assert.equal(presets[3]?.name, 'Heavy Metal 2'); // record "Heavy Metal 2\0O\0\0"
  assert.equal(presets[6]?.name, 'Crusher'); // record "Crusher\0x\0K\0    \0"
});

test('parseMbIrNames reads the 20 user IR slots', () => {
  const names = parseMbIrNames(unwrapMbMessage(replyTo(REQUESTS[4] as Uint8Array)).data);
  assert.equal(names.length, 20);
  assert.equal(names[0], 'Marshall War30s ');
  assert.equal(names[1], 'V30UK SM57');
  assert.equal(names[3], 'Holy Grail ll 4x');
  assert.equal(names[5], 'User IR 6');
  assert.equal(names[19], 'User IR 20');
});

test('parseMbCloneNames reads the 10 capture slots', () => {
  const names = parseMbCloneNames(unwrapMbMessage(replyTo(REQUESTS[5] as Uint8Array)).data);
  assert.deepEqual(names, ['1 FENDER', '2 VOX', '3 PLEXI', '4 JCM800', '5 RECTIFIER', 'Clone 6', 'Clone 7', 'Clone 8', 'Clone 9', 'Clone 10']);
});

test('the name parsers reject tables of the wrong size', () => {
  assert.throws(() => parseMbPresetNames(new Uint8Array(7443)), /preset list/);
  assert.throws(() => parseMbPresetNames(new Uint8Array(4)), /preset list/);
  assert.throws(() => parseMbIrNames(new Uint8Array(499)), /500/);
  assert.throws(() => parseMbCloneNames(new Uint8Array(250)), /252/);
});

test('parsers accept synthetic tables: a 17-byte name with no NUL keeps all 17 bytes', () => {
  const ir = new Uint8Array(500);
  ir.set(
    Array.from('ABCDEFGHIJKLMNOPQ', (c) => c.charCodeAt(0)),
    160,
  );
  assert.equal(parseMbIrNames(ir)[0], 'ABCDEFGHIJKLMNOPQ');
  assert.equal(parseMbIrNames(ir)[1], '');
  const list = new Uint8Array(4 + 2 * 31);
  list.set([0x41, 0x00, 0x42], 4 + 2 * 4 + 17);
  list.set([0x50, 0x6f, 0x70], 4 + 2 * 21 + 10);
  assert.deepEqual(parseMbPresetNames(list), [
    { name: '', style: '' },
    { name: 'A', style: 'Pop' },
  ]);
});
