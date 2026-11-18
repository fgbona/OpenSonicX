import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame } from '../src/frame.ts';
import { decodeNotification } from '../src/notify.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { Reassembler } from '../src/reassembler.ts';
import { readCapture } from './capture.ts';
import { modelsFor } from '../src/catalog.ts';

const knobs = readCapture('knob-capture.txt').map((m) => parseFrame(m.bytes).payload);
function p08(): Preset {
  const r = new Reassembler();
  const rx = readCapture('p08-capture.txt').filter((m) => m.dir === 'RX').slice(1);
  return decodePreset(rx.map((m) => r.feed(parseFrame(m.bytes), 0)).at(-1)!.payload);
}

test('a knob turned on the pedal becomes a parameter edit', () => {
  const p = p08();
  assert.deepEqual(decodeNotification(knobs[0]!, p), { kind: 'param', module: 0, alg: 0, value: 16 });
  assert.deepEqual(decodeNotification(knobs[1]!, p), { kind: 'param', module: 1, alg: 0, value: 21 });
  assert.deepEqual(decodeNotification(knobs[2]!, p), { kind: 'param', module: 3, alg: 3, value: 52 });
});

test('a block switched on the pedal becomes an on/off edit', () => {
  const p = p08();
  assert.deepEqual(decodeNotification(knobs[3]!, p), { kind: 'on', module: 3, on: false });
  assert.deepEqual(decodeNotification(knobs[4]!, p), { kind: 'on', module: 3, on: true });
});

test('a captured-profile parameter (module 9) edits AMP when the preset is in clone mode', () => {
  const payload = Uint8Array.from([0x12, 0x48, 9, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0x48, 0x42]);
  const profile = modelsFor('clone')[0]!;
  const base = p08();
  const clone: Preset = { ...base, ampMode: 'clone', chain: base.chain.map((b) => (b.module === 3 ? { ...b, code: profile.code } : b)) };
  assert.deepEqual(decodeNotification(payload, clone), { kind: 'param', module: 3, alg: 1, value: 50 });
  assert.equal(decodeNotification(payload, p08()), null, 'ignored when the screen shows an amp model');
});

test('amp mode switched on the pedal is reported for a re-read, not applied', () => {
  const payload = Uint8Array.from([0x12, 0x49, 9, 0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(decodeNotification(payload, p08()), { kind: 'reread' });
});

test('a model changed on the pedal (short 12 47 form) asks for a re-read', () => {
  const payload = Uint8Array.from([0x12, 0x47, 2, 0, 0, 0, 2, 0, 0, 3]);
  assert.deepEqual(decodeNotification(payload, p08()), { kind: 'reread' });
});

test('our own commands, acknowledges, flags and malformed frames are not notifications', () => {
  const p = p08();
  assert.equal(decodeNotification(knobs[5]!, p), null, 'TX 11 48 is ours');
  assert.equal(decodeNotification(knobs[6]!, p), null, '12 45 modified flag');
  assert.equal(decodeNotification(knobs[7]!, p), null, '14 08 acknowledge');
  assert.equal(decodeNotification(Uint8Array.from([0x12, 0x48, 3, 0]), p), null, 'truncated');
  assert.equal(decodeNotification(Uint8Array.from([0x12, 0x48, 3, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0xc0, 0x7f]), p), null, 'NaN value');
  assert.equal(decodeNotification(Uint8Array.from([0x12, 0x48, 3, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0x48, 0x42]), p), null, 'no such slot on the model');
});
