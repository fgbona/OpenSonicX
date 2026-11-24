import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, decodePreset, modelsFor } from '@pocket-master/core';
import { realP08 } from '../../../packages/core/test/fake-pedal.ts';
import { toneChanges } from '../lib/tone-changes.ts';

const p08 = decodePreset(realP08());

test("a parameter row names the block's model, and says when the block is off", () => {
  const rvb = p08.chain.find((b) => b.key === 'rvb')!;
  const mix = rvb.params[0]!;
  const after = applyEdit(p08, { kind: 'param', module: rvb.module, alg: mix.alg, value: mix.value - 5 });
  assert.deepEqual(toneChanges(p08, after), [{ block: 'RVB · Plate 2 (off)', what: 'param', name: mix.name, from: mix.display, to: String(mix.value - 5) }]);
});

test('a new model is followed by the values it now has', () => {
  const room = modelsFor('rvb').find((m) => m.name === 'Room')!;
  const after = applyEdit(applyEdit(p08, { kind: 'model', module: 8, code: room.code }), { kind: 'on', module: 8, on: true });
  const rows = toneChanges(p08, after);
  assert.deepEqual(rows[0], { block: 'RVB', what: 'model', from: 'Plate 2', to: 'Room' });
  const values = rows.filter((r) => r.what === 'param');
  assert.equal(values.length, after.chain.find((b) => b.key === 'rvb')!.params.length);
  assert.ok(values.every((r) => 'block' in r && r.block === 'RVB · Room' && r.from === '–'));
  assert.deepEqual(rows.at(-1), { block: 'RVB', what: 'on', from: 'off', to: 'on' });
});
