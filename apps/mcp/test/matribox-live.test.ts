import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHex, MB_WRITE, mbAssignments, parseMbFrame, parseMbPreset } from '@pocket-master/core';
import { call, connected, text } from './matribox-helpers.ts';

const EXPERIMENTAL = /Experimental/;
const writes = (fake: { received: string[] }) => fake.received.filter((hex) => parseMbFrame(fromHex(hex)).type === MB_WRITE).length;
const assignments = (fake: { editBuffer: Uint8Array }) => mbAssignments(parseMbPreset(fake.editBuffer));

test('matribox_get_assignments shows volume, tempo, footswitches and expression entries', async () => {
  const { client } = await connected();
  const out = await call(client, 'matribox_get_assignments');
  assert.match(out, /^17C "Drive AD": patch volume 45, tempo 120 BPM, EXP 1 mode A$/m);
  assert.match(out, /^Footswitch A: CTRL 1 \(toggles 1 DYN\)$/m);
  assert.match(out, /^CTRL 1: 1 DYN$/m);
  assert.match(out, /^Quick knob 3: patch volume$/m);
  assert.match(out, /^Expression entry 1: 6 VOL Volume, 0\.\.100 %$/m);
});

test('matribox_set_volume writes the patch volume and says it is live and experimental', async () => {
  const { client, fake } = await connected();
  const out = await call(client, 'matribox_set_volume', { volume: 80 });
  assert.match(out, /^Patch volume 45 → 80$/m);
  assert.match(out, EXPERIMENTAL);
  assert.equal(assignments(fake).volume, 80);
});

test('matribox_assign_footswitch assigns and removes a block, checked by reading back', async () => {
  const { client, fake } = await connected();
  assert.match(await call(client, 'matribox_assign_footswitch', { footswitch: 'C', block: 'DRV' }), /^Footswitch C now toggles 2 DRV \(through CTRL 3\)\. It toggles: .*DRV/m);
  assert.ok(assignments(fake).ctrl[2]?.includes(0));
  assert.match(await call(client, 'matribox_assign_footswitch', { footswitch: 'C', block: '2', assign: false }), /^Footswitch C no longer toggles 2 DRV/m);
  assert.ok(!assignments(fake).ctrl[2]?.includes(0));
});

test('a footswitch on the tuner is set to its own CTRL before it toggles a block', async () => {
  const { client, fake } = await connected();
  assert.match(await call(client, 'matribox_set_footswitch_function', { footswitch: 'B', function: 'tuner' }), /^Footswitch B pressed: tuner \(stomp mode\)\.$/m);
  assert.equal(assignments(fake).footswitches[1]?.press, 7);
  assert.match(await call(client, 'matribox_assign_footswitch', { footswitch: 'B', block: 'DRV' }), /through CTRL 2/);
  assert.equal(assignments(fake).footswitches[1]?.press, 2);
  assert.ok(assignments(fake).ctrl[1]?.includes(0));
  await call(client, 'matribox_set_footswitch_function', { footswitch: 'A', function: 'tap tempo', hold: true });
  assert.equal(assignments(fake).footswitches[0]?.hold, 8);
});

test('matribox_assign_ctrl and matribox_assign_quick_knob change the preset, read back', async () => {
  const { client, fake } = await connected();
  assert.match(await call(client, 'matribox_assign_ctrl', { ctrl: 4, block: 'DRV' }), /^CTRL 4 now holds 2 DRV\.$/m);
  assert.ok(assignments(fake).ctrl[3]?.includes(0));
  assert.match(await call(client, 'matribox_assign_quick_knob', { knob: 1, target: 'DRV', parameter: 'gain' }), /^Quick knob 1 → 2 DRV Fake Drive Gain$/m);
  assert.deepEqual(assignments(fake).quickKnobs[0], { knob: 0, target: 0, paramId: 0 });
  await call(client, 'matribox_assign_quick_knob', { knob: 2, target: 'BPM' });
  assert.deepEqual(assignments(fake).quickKnobs[1], { knob: 1, target: 12, paramId: 0 });
  await call(client, 'matribox_assign_quick_knob', { knob: 3, target: 'none' });
  assert.equal(assignments(fake).quickKnobs[2]?.target, null);
});

test('matribox_assign_expression points an entry at a parameter; the range can change after', async () => {
  const { client, fake } = await connected();
  const out = await call(client, 'matribox_assign_expression', { entry: 4, block: 'DRV', parameter: 'tone', min: 10, max: 90 });
  assert.match(out, /^Expression entry 4 → 2 DRV Fake Drive Tone, 10\.\.90 %$/m);
  assert.deepEqual(assignments(fake).expression[3], { entry: 3, slot: 0, paramId: 1, min: 10, max: 90 });
  assert.match(await call(client, 'matribox_set_expression_range', { entry: 4, max: 70 }), /^Expression entry 4: 10\.\.70 %$/m);
});

test('the assignment tools refuse bad input before writing anything', async () => {
  const { client, fake } = await connected();
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['matribox_assign_expression', { entry: 1, block: 'DLY', parameter: 'Mix' }, /No block "DLY"/],
    ['matribox_assign_expression', { entry: 1, block: 'DRV', parameter: 'Drive' }, /no parameter "Drive"/],
    ['matribox_assign_expression', { entry: 10, block: 'DRV', parameter: 'Gain' }, /entry/],
    ['matribox_assign_footswitch', { footswitch: 'E', block: 'DRV' }, /footswitch/],
    ['matribox_assign_ctrl', { ctrl: 5, block: 'DRV' }, /ctrl/i],
    ['matribox_set_footswitch_function', { footswitch: 'A', function: 'boost' }, /function/],
    ['matribox_assign_quick_knob', { knob: 1, target: 'DRV' }, /name the parameter/],
    ['matribox_assign_quick_knob', { knob: 1, target: 'DRV', parameter: 'Drive' }, /no parameter "Drive"/],
    ['matribox_assign_quick_knob', { knob: 4, target: 'BPM' }, /knob/],
    ['matribox_set_volume', { volume: 101 }, /volume/],
    ['matribox_set_expression_range', { entry: 1 }, /give min, max or both/],
  ];
  for (const [tool, args, message] of cases) {
    const result = await client.callTool({ name: tool, arguments: args });
    assert.equal(result.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert.match(text(result), message);
  }
  assert.equal(writes(fake), 0);
});

test("the CC tools send the manual's Control Changes on the given channel and expect no answer", async () => {
  const { client, fake } = await connected();
  assert.match(await call(client, 'matribox_tuner', { on: true }), /^Tuner on \(CC 58 = 127, MIDI channel 1\)\.$/m);
  await call(client, 'matribox_tap_tempo', { channel: 3 });
  assert.match(await call(client, 'matribox_set_bpm', { bpm: 140 }), /CC 68 = 1, CC 69 = 12/);
  await call(client, 'matribox_looper', { action: 'record' });
  await call(client, 'matribox_looper', { action: 'playback_volume', value: 60 });
  await call(client, 'matribox_drum', { action: 'rhythm', value: 12 });
  await call(client, 'matribox_ctrl', { ctrl: 4, value: 127 });
  const out = await call(client, 'matribox_quick_knob', { knob: 3, value: 50 });
  assert.match(out, /no answer/);
  assert.match(out, EXPERIMENTAL);
  assert.deepEqual(fake.controls, ['b03a7f', 'b2467f', 'b04401', 'b0450c', 'b03c7f', 'b0423c', 'b05e0c', 'b04a7f', 'b01432']);
});

test('the CC tools refuse a missing or out-of-range value', async () => {
  const { client, fake } = await connected();
  for (const [tool, args] of [
    ['matribox_looper', { action: 'record_volume' }],
    ['matribox_drum', { action: 'rhythm', value: 100 }],
    ['matribox_set_bpm', { bpm: 39 }],
  ] as const) {
    const result = await client.callTool({ name: tool, arguments: args });
    assert.equal(result.isError, true, `${tool} ${JSON.stringify(args)}`);
  }
  assert.deepEqual(fake.controls, []);
});
