import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbCatalog, parseMbPreset } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_ALG_DATA } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { editChain } from '../lib/matriboxPlan.ts';
import { mbCatalogText, mbChanges, mbModelsText, mbPresetText } from '../lib/matriboxText.ts';

const catalog = parseMbCatalog(FAKE_ALG_DATA);
const preset = () => parseMbPreset(new FakeMatribox().editBuffer);

test('the catalog for the first message: one line a module, models with the gear they are based on', () => {
  const compact = mbCatalogText(catalog, false);
  assert.match(compact, /^DRV: Fake Drive \(Imaginary Overdrive 808\); Fake Fuzz \(Imaginary Fuzz Face\)$/m);
  assert.match(compact, /^RVB: Fake Hall$/m);
  assert.doesNotMatch(compact, /Gain/);
  const full = mbCatalogText(catalog, true);
  assert.match(full, /^DLY: Fake Echo \(Imaginary Tape Echo\) \[Mix, Time 20\.\.2000\]$/m);
  assert.match(full, /0\.\.100 unless/);
});

test('list_models gives the parameters with ranges and defaults, for the modules asked', () => {
  const text = mbModelsText(catalog, ['dly']);
  assert.equal(text, 'DLY\n- Fake Echo (based on Imaginary Tape Echo): Mix 0..100 (default 0), Time 20..2000 (default 20)');
  assert.throws(() => mbModelsText(catalog, ['XYZ']), /No module "XYZ"/);
  assert.match(mbModelsText(catalog), /^DYN\n/);
});

test('the loaded preset: chain in signal order, each block with its gear, on/off and values in range', () => {
  const text = mbPresetText(preset(), catalog);
  assert.match(text, /^Name: Drive AD$/m);
  assert.match(text, /^Chain: DYN → DRV → AMP → CAB → RVB → VOL$/m);
  assert.match(text, /^2\. DRV off Fake Drive \(based on Imaginary Overdrive 808\): Gain 15 \(0\.\.100\), Tone 50 \(0\.\.100\), Volume 14 \(0\.\.100\)$/m);
  assert.match(text, /^4\. CAB on unknown model 0x0a000006$/m);
});

test('what changed: order, models with their new values, switches and values, by block', () => {
  const before = preset();
  const after = { ...before, chain: editChain(catalog, before.chain, [
    { kind: 'parameter', block: 'AMP', parameter: 'Gain', value: 70 },
    { kind: 'model', block: 'DRV', model: 'Fake Fuzz' },
    { kind: 'block', block: 'RVB', on: false },
    { kind: 'remove', block: 'VOL' },
  ]).map((b, i) => ({ ...b, slot: i })) };
  assert.deepEqual(mbChanges(before, after, catalog, 'off'), [
    { what: 'order', from: 'DYN DRV AMP CAB RVB VOL', to: 'DYN DRV AMP CAB RVB' },
    { block: 'DRV', what: 'model', from: 'Fake Drive', to: 'Fake Fuzz' },
    { block: 'DRV · Fake Fuzz (off)', what: 'param', name: 'Fuzz', from: '–', to: '0' },
    { block: 'DRV · Fake Fuzz (off)', what: 'param', name: 'Level', from: '–', to: '0' },
    { block: 'AMP · Fake Plexi', what: 'param', name: 'Gain', from: '30', to: '70' },
    { block: 'RVB', what: 'on', from: 'on', to: 'off' },
  ]);
});
