import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { fromHex, toHex } from '../src/hex.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import {
  MB_GLOBALS,
  mbReadGlobalState,
  mbSetGlobal,
  mbSetGlobalEqGain,
  mbSetGlobalEqLevel,
  mbSetGlobalEqOn,
  mbWriteGlobalEqOn,
  parseMbGlobalEq,
  parseMbGlobalEqOn,
  parseMbGlobals,
} from '../src/matribox/globals.ts';
import { FakeMatribox } from './fake-matribox.ts';

// Frames of the official editor's global settings window (captures mb-30 … mb-39), by name.
const FRAMES = new Map(
  readFileSync(new URL('./fixtures/matribox-globals.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf(' ')), fromHex(l.slice(l.indexOf(' ') + 1))] as const),
);
const captured = (name: string) => {
  const frame = FRAMES.get(name);
  assert.ok(frame, `fixture has ${name}`);
  return toHex(frame);
};
const dataOf = (name: string) => unwrapMbMessage(parseMbFrame(fromHex(captured(name))).payload).data;

test('the global setting writes rebuild the captured host frames byte for byte', () => {
  assert.equal(toHex(mbSetGlobal('inputLevel', 5)), captured('input-level-5'));
  assert.equal(toHex(mbSetGlobal('auxLevel', 80)), captured('aux-level-80'));
  assert.equal(toHex(mbSetGlobal('currentMode', 1)), captured('current-mode-1'));
  assert.equal(toHex(mbSetGlobal('midiChannelUsb', 5)), captured('midi-channel-usb-5'));
  assert.equal(toHex(mbSetGlobal('midiSource', 1)), captured('midi-source-1'));
  assert.equal(toHex(mbSetGlobal('inputMode', 2)), captured('input-mode-2'));
});

test('the global EQ writes rebuild the captured host frames byte for byte', () => {
  assert.equal(toHex(mbSetGlobalEqGain(1, 3)), captured('eq-band2-gain-3'));
  assert.equal(toHex(mbSetGlobalEqLevel(70)), captured('eq-level-70'));
  assert.equal(toHex(mbSetGlobalEqOn(false)), captured('eq-on-0'));
  assert.equal(toHex(mbSetGlobalEqOn(true)), captured('eq-on-1'));
});

test('the unit answers the EQ switch with 00 00 00 00 + u32, not an echo', () => {
  assert.equal(parseMbGlobalEqOn(dataOf('eq-on-answer-0')), false);
  assert.equal(parseMbGlobalEqOn(dataOf('eq-on-answer-1')), true);
  assert.throws(() => parseMbGlobalEqOn(dataOf('eq-on-1')), /EQ switch/); // the request itself is not an answer
});

test('writes outside what was captured are refused before anything is sent', () => {
  assert.throws(() => mbSetGlobal('midiSource', 0), /midiSource/); // TRS Only: the editor's Control Changes need USB
  assert.throws(() => mbSetGlobal('inputLevel', 21), /inputLevel/);
  assert.throws(() => mbSetGlobal('inputLevel', 1.5), /inputLevel/);
  assert.throws(() => mbSetGlobal('midiChannelUsb', 17), /midiChannelUsb/);
  assert.throws(() => mbSetGlobalEqGain(4, 0), /band/);
  assert.throws(() => mbSetGlobalEqGain(0, 21), /gain/);
  assert.throws(() => mbSetGlobalEqLevel(101), /level/);
  assert.throws(() => mbSetGlobalEqLevel(Number.NaN), /level/);
});

test('a negative input level goes as a two-complement int32 and reads back from its byte', () => {
  const data = unwrapMbMessage(parseMbFrame(mbSetGlobal('inputLevel', -6)).payload).data;
  assert.equal(toHex(data), '00 21 00 00 FA FF FF FF');
  const table = new Uint8Array(52);
  table[MB_GLOBALS.inputLevel.at] = 0xfa;
  assert.equal(parseMbGlobals(table).inputLevel, -6);
});

/** The general table as the unit sent it in capture mb-38 (bytes shown in docs/matribox.md). */
function generalTable(): Uint8Array {
  const t = new Uint8Array(52);
  for (const [at, v] of [
    [2, 2],
    [5, 1],
    [9, 1],
    [11, 80],
    [14, 5],
    [15, 2],
    [20, 1],
    [21, 1],
    [22, 1],
    [35, 1],
    [36, 5],
    [44, 2],
    [45, 4],
    [47, 80],
    [48, 100],
    [49, 0],
    [50, 1],
  ] as const)
    t[at] = v;
  return t;
}

test('the general table decodes to the settings changed in mb-30 … mb-38', () => {
  assert.deepEqual(parseMbGlobals(generalTable()), {
    inputLevel: 5,
    auxLevel: 80,
    inputMode: 2,
    currentMode: 1,
    midiChannelUsb: 5,
    midiSource: 2,
    tempo: { on: true, bpm: 100 },
  });
  const off = generalTable();
  off.set([0xff, 0xff, 0], 48); // the first sessions: never set, off
  assert.deepEqual(parseMbGlobals(off).tempo, { on: false, bpm: null });
  assert.throws(() => parseMbGlobals(new Uint8Array(51)), /52/);
});

test('the global EQ table decodes to its level and its switch, frequency, Q and gain groups', () => {
  const words = [1, 80, 0.71, 0, 20, 0.71, 0, 1, 250, 1, -1, 1, 500, 0.71, 3, 1, 1000, 0.71, 0, 1, 5000, 1, 1, 0, 20000, 0.71, 0, 1, 8000, 0.71, 70];
  const eq = parseMbGlobalEq(new Uint8Array(new Float32Array(words).buffer));
  assert.equal(eq.level, 70);
  assert.deepEqual(
    eq.bands.map((b) => [b.on, b.frequency, b.gain]),
    [
      [true, 250, -1],
      [true, 500, 3],
      [true, 1000, 0],
      [true, 5000, 1],
    ],
  );
  assert.equal(Math.round(eq.bands[1]!.q * 100), 71);
  assert.deepEqual([eq.lowCut.on, eq.lowCut.frequency, eq.highCut.on, eq.highCut.frequency], [false, 20, false, 20000]);
  assert.throws(() => parseMbGlobalEq(new Uint8Array(120)), /124/);
});

const linked = (fake: FakeMatribox) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 1000);

test('the link reads the globals from the simulated unit and every write is confirmed and kept', async () => {
  const fake = new FakeMatribox(); // its noise (a flag-0 cmd 0x11 message) must not pass for the 52-byte table
  const link = linked(fake);
  const before = await mbReadGlobalState(link);
  assert.equal(before.general.midiSource, 2);
  assert.equal(before.eqOn, true);
  await link.write(mbSetGlobal('inputLevel', -3));
  await link.write(mbSetGlobal('midiChannelUsb', 7));
  await link.write(mbSetGlobalEqGain(1, 3));
  await link.write(mbSetGlobalEqLevel(70));
  await mbWriteGlobalEqOn(link, false);
  const after = await mbReadGlobalState(link);
  assert.equal(after.general.inputLevel, -3);
  assert.equal(after.general.midiChannelUsb, 7);
  assert.equal(after.eq.bands[1]?.gain, 3);
  assert.equal(after.eq.level, 70);
  assert.equal(after.eqOn, false);
});

test('an EQ switch the unit does not take is an error', async () => {
  const fake = new FakeMatribox();
  fake.ignoresEqSwitch = true;
  await assert.rejects(mbWriteGlobalEqOn(linked(fake), false), /global EQ/);
});
