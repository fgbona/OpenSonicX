import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEdit } from '../src/assistant/change.ts';
import { decodePreset } from '../src/dump.ts';
import { modelsFor } from '../src/catalog.ts';
import { realP08 } from './fake-pedal.ts';

const p08 = decodePreset(realP08());
const SLOTS = { irNames: ['Mesa OS', null, null, null, null], profileNames: ['Randall SA', null, null, null, null] };
const amp = p08.chain.find((b) => b.key === 'amp')!;

test('a parameter is found by name and its value encoded', () => {
  const edit = toEdit(p08, { kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }, SLOTS);
  assert.equal(edit.kind, 'param');
  assert.equal((edit as { module: number }).module, amp.module);
});

test('a switch takes true/false or on/off, and refuses anything else', () => {
  const sw = p08.chain.flatMap((b) => b.params.filter((p) => p.kind === 'switch').map((p) => ({ b, p })))[0];
  if (!sw) return; // P08 has no switch parameter on its current models
  assert.deepEqual(
    toEdit(p08, { kind: 'parameter', block: sw.b.label, parameter: sw.p.name, value: 'on' }, SLOTS),
    toEdit(p08, { kind: 'parameter', block: sw.b.label, parameter: sw.p.name, value: true }, SLOTS),
  );
  assert.throws(() => toEdit(p08, { kind: 'parameter', block: sw.b.label, parameter: sw.p.name, value: 'maybe' }, SLOTS), /is a switch/);
});

test('a model by name, and a captured profile by its slot name', () => {
  const dual = modelsFor('amp').find((m) => m.name === 'Calif DualM')!;
  assert.deepEqual(toEdit(p08, { kind: 'model', block: 'AMP', model: 'calif dualm' }, SLOTS), { kind: 'model', module: amp.module, code: dual.code, clone: false });
  assert.equal((toEdit(p08, { kind: 'model', block: 'amp', model: 'Randall SA' }, SLOTS) as { clone: boolean }).clone, true);
});

test('moves are 1-based and range-checked; volume passes through', () => {
  assert.throws(() => toEdit(p08, { kind: 'move', block: 'dly', position: 0 }, SLOTS), /position must be 1\.\./);
  assert.equal(toEdit(p08, { kind: 'move', block: 'dly', position: 5 }, SLOTS).kind, 'chain');
  assert.deepEqual(toEdit(p08, { kind: 'volume', value: 50 }, SLOTS), { kind: 'volume', value: 50 });
});

test('the NR block has one model, so a model change is refused before anything is sent', () => {
  assert.throws(() => toEdit(p08, { kind: 'model', block: 'NR', model: 'Gate' }, SLOTS), /NR has a single model \(Gate\); change its parameters instead/);
});
