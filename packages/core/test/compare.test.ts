import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePresets } from '../src/compare.ts';
import { decodePreset } from '../src/dump.ts';
import { applyEdit, type Edit } from '../src/edit.ts';
import { modelsFor } from '../src/catalog.ts';
import { realP08 } from './fake-pedal.ts';

const p08 = decodePreset(realP08());
const edited = (...edits: Edit[]) => edits.reduce(applyEdit, p08);
const amp = p08.chain.find((b) => b.key === 'amp')!;
const gain = amp.params.find((p) => /gain/i.test(p.name))!;

test('the same preset has no differences', () => {
  assert.deepEqual(comparePresets(p08, p08), []);
});

test('lists parameters, on/off, volume and order in signal-chain terms', () => {
  const other = edited(
    { kind: 'param', module: amp.module, alg: gain.alg, value: gain.value + 10 },
    { kind: 'on', module: 7, on: true },
    { kind: 'volume', value: 50 },
    { kind: 'chain', order: [0, 1, 2, 3, 4, 5, 7, 6, 8] },
  );
  assert.deepEqual(comparePresets(p08, other), [
    { what: 'order', from: 'NR FX1 DRV AMP IR EQ FX2 DLY RVB', to: 'NR FX1 DRV AMP IR EQ DLY FX2 RVB' },
    { block: 'AMP', what: 'param', name: gain.name, from: gain.display, to: String(gain.value + 10) },
    { block: 'DLY', what: 'on', from: 'off', to: 'on' },
    { what: 'volume', from: '65', to: '50' },
  ]);
});

test('a different model is one line: its parameters are not comparable', () => {
  const butter = modelsFor('drv').find((m) => m.name === 'Butter OD')!;
  assert.deepEqual(comparePresets(p08, edited({ kind: 'model', module: 2, code: butter.code })), [
    { block: 'DRV', what: 'model', from: 'Scream', to: 'Butter OD' },
  ]);
});
