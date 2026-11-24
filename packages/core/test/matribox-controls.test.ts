import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMbFrame, readFloat32LE } from '../src/matribox/frame.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { mbAssignExpression, mbAssignFootswitch, mbExpressionWrites, mbSetExpressionMax, mbSetExpressionMin, mbSetPatchVolume } from '../src/matribox/write.ts';
import { fromHex, toHex } from '../src/hex.ts';
import { parseMbPreset } from '../src/matribox/preset.ts';
import { mbAssignments, withMbVolume } from '../src/matribox/assignments.ts';
import { isMbControlChange, MB_CC, mbBpmControlChanges, mbControlChange, mbSwitch } from '../src/matribox/cc.ts';

// Host frames the official editor sent (captures mb-01, mb-04, mb-09), by name.
const HOST = new Map(
  readFileSync(new URL('./fixtures/matribox-controls.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf(' ')), fromHex(l.slice(l.indexOf(' ') + 1))] as const),
);

const host = (name: string) => {
  const frame = HOST.get(name);
  assert.ok(frame, `fixture has ${name}`);
  return frame;
};
/** The f32 the captured frame carries at data offset `at` (the editor's slider values are not round numbers). */
const capturedFloat = (name: string, at: number) => readFloat32LE(unwrapMbMessage(parseMbFrame(host(name)).payload).data, at);

test('patch volume rebuilds the captured frames byte for byte', () => {
  assert.equal(toHex(mbSetPatchVolume(52)), toHex(host('volume-52')));
  assert.equal(toHex(mbSetPatchVolume(77)), toHex(host('volume-77')));
});

test('patch volume is an integer 0..100', () => {
  for (const bad of [-1, 101, 50.5, Number.NaN]) assert.throws(() => mbSetPatchVolume(bad), RangeError);
  assert.doesNotThrow(() => mbSetPatchVolume(0));
  assert.doesNotThrow(() => mbSetPatchVolume(100));
});

test('footswitch assignment rebuilds the captured frames byte for byte', () => {
  assert.equal(toHex(mbAssignFootswitch(0, 0, true)), toHex(host('fs-A-slot0-assign')));
  assert.equal(toHex(mbAssignFootswitch(0, 0, false)), toHex(host('fs-A-slot0-unassign')));
  assert.equal(toHex(mbAssignFootswitch(0, 1, true)), toHex(host('fs-A-slot1-assign')));
});

test('footswitch assignment checks the switch (A..D) and the slot', () => {
  assert.throws(() => mbAssignFootswitch(4, 0, true), RangeError);
  assert.throws(() => mbAssignFootswitch(-1, 0, true), RangeError);
  assert.throws(() => mbAssignFootswitch(0, 12, true), RangeError);
  assert.doesNotThrow(() => mbAssignFootswitch(3, 11, false));
});

test('expression assignment, min and max rebuild the captured frames byte for byte', () => {
  assert.equal(toHex(mbAssignExpression({ entry: 0, slot: 0, paramId: 0, min: 0, max: 100 })), toHex(host('exp-assign-entry0-slot0-param0')));
  assert.equal(toHex(mbSetExpressionMin(0, capturedFloat('exp-min-entry0', 12))), toHex(host('exp-min-entry0')));
  assert.equal(toHex(mbSetExpressionMax(0, capturedFloat('exp-max-entry0', 12))), toHex(host('exp-max-entry0')));
});

test("expression assignment field order, as the owner's unit took it (2026-11-24): group, position, slot, param", () => {
  // Checked live: (1,0,1,0) landed in entry 4 (group 1 = EXP 1 mode B, position 0) on slot 1 (AMP),
  // (0,0,1,1) in entry 1 on slot 1 parameter 1 (AMP Volume). Entry 0..8 = group * 3 + position.
  const data = (frame: Uint8Array) => toHex(frame).replace(/ /g, '');
  const body = (vals: number[]) => vals.map((v) => [v, 0, 0, 0].map((b) => b.toString(16).padStart(2, '0')).join('')).join('');
  const sent = (frame: Uint8Array) => unwrapMbMessage(parseMbFrame(frame).payload).data;
  assert.equal(Buffer.from(sent(mbAssignExpression({ entry: 3, slot: 1, paramId: 0, min: 0, max: 100 })).subarray(4, 20)).toString('hex'), body([1, 0, 1, 0]));
  assert.equal(Buffer.from(sent(mbAssignExpression({ entry: 0, slot: 1, paramId: 1, min: 0, max: 100 })).subarray(4, 20)).toString('hex'), body([0, 0, 1, 1]));
  assert.equal(Buffer.from(sent(mbAssignExpression({ entry: 8, slot: 11, paramId: 14, min: 0, max: 100 })).subarray(4, 20)).toString('hex'), body([2, 2, 11, 14]));
  assert.equal(Buffer.from(sent(mbSetExpressionMin(4, 10)).subarray(4, 12)).toString('hex'), body([1, 1]));
  void data;
});

test('an expression assignment goes with the full range, the ends that differ follow (the unit ignores the range in it)', () => {
  const a = { entry: 4, slot: 4, paramId: 1, min: 20, max: 80 };
  assert.deepEqual(mbExpressionWrites(a).map(toHex), [mbAssignExpression({ ...a, min: 0, max: 100 }), mbSetExpressionMin(4, 20), mbSetExpressionMax(4, 80)].map(toHex));
  assert.equal(mbExpressionWrites({ ...a, min: 0, max: 100 }).length, 1);
});

test('expression writes check the entry, slot, parameter and the 0..100 range', () => {
  const ok = { entry: 8, slot: 11, paramId: 14, min: 0, max: 100 };
  assert.doesNotThrow(() => mbAssignExpression(ok));
  for (const bad of [{ entry: 9 }, { slot: 12 }, { paramId: 15 }, { min: -1 }, { max: 100.5 }, { min: Number.NaN }]) {
    assert.throws(() => mbAssignExpression({ ...ok, ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => mbSetExpressionMin(9, 10), RangeError);
  assert.throws(() => mbSetExpressionMax(0, 101), RangeError);
});

// The owner's "Drive AD" (decompressed device reply).
const DRIVE_AD = parseMbPreset(
  fromHex(
    readFileSync(new URL('./fixtures/matribox-preset-drive-ad.txt', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .join(''),
  ),
);

test('mbAssignments reads volume, tempo, footswitches and expression entries', () => {
  const a = mbAssignments(DRIVE_AD);
  assert.equal(a.volume, 45);
  assert.equal(a.tempo, 120);
  assert.equal(a.expressionMode, 0);
  assert.deepEqual(a.expression[0], { entry: 0, slot: 5, paramId: 0, min: 0, max: 100 });
  assert.equal(a.expression.filter((e) => e.slot !== null).length, 1);
  assert.equal(a.footswitches.length, 4);
  assert.deepEqual(a.footswitches[0], [1]);
});

test('withMbVolume changes the volume only, leaving the preset as it was', () => {
  const louder = withMbVolume(DRIVE_AD, 80);
  assert.equal(mbAssignments(louder).volume, 80);
  assert.equal(mbAssignments(DRIVE_AD).volume, 45);
  assert.equal(mbAssignments(louder).tempo, 120);
});

test('Control Change messages: channel 1..16, 7-bit controller and value', () => {
  assert.deepEqual([...mbControlChange(1, MB_CC.tuner, mbSwitch(true))], [0xb0, 58, 127]);
  assert.deepEqual([...mbControlChange(16, MB_CC.tapTempo, 127)], [0xbf, 70, 127]);
  for (const [ch, cc, v] of [
    [0, 1, 1],
    [17, 1, 1],
    [1, 128, 1],
    [1, 1, 128],
    [1, 1, 1.5],
  ] as const) {
    assert.throws(() => mbControlChange(ch, cc, v), RangeError);
  }
  assert.equal(isMbControlChange(mbControlChange(3, 7, 50)), true);
  assert.equal(isMbControlChange(Uint8Array.of(0x90, 60, 100)), false);
});

test('BPM is sent as CC 68 (MSB) and CC 69 (LSB), 40..300', () => {
  assert.deepEqual(
    mbBpmControlChanges(1, 120).map((m) => [...m]),
    [
      [0xb0, 68, 0],
      [0xb0, 69, 120],
    ],
  );
  assert.deepEqual(
    mbBpmControlChanges(1, 300).map((m) => [...m]),
    [
      [0xb0, 68, 2],
      [0xb0, 69, 44],
    ],
  );
  assert.deepEqual(
    mbBpmControlChanges(2, 128).map((m) => [...m]),
    [
      [0xb1, 68, 1],
      [0xb1, 69, 0],
    ],
  );
  for (const bad of [39, 301, 120.5]) assert.throws(() => mbBpmControlChanges(1, bad), RangeError);
});
