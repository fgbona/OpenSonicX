import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePreset, MB_CATALOG, parseMbPreset, resolveMbPreset } from '@pocket-master/core';
import { realP08 } from '../../../packages/core/test/fake-pedal.ts';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { mbRigBlocks, pmParamValue, pmRigBlocks } from '../lib/rigBlocks.ts';
import { pmRigCategory } from '../lib/rigIcon.ts';
import { initialRigLook } from '../lib/rigLook.ts';

test('the new look opens with ?rig=1 or a saved "1"; classic otherwise', () => {
  assert.equal(initialRigLook('', null), false);
  assert.equal(initialRigLook('?rig=1', null), true);
  assert.equal(initialRigLook('?rig=0', '1'), true);
  assert.equal(initialRigLook('', '1'), true);
  assert.equal(initialRigLook('', '0'), false);
  assert.equal(initialRigLook('?x=1', 'yes'), false);
});

test('Pocket Master blocks map to the same gear kinds as the Matribox', () => {
  const b = (key: string, model = '') => ({ key, model });
  assert.equal(pmRigCategory(b('nr', 'Gate'), 'normal'), 'gate');
  assert.equal(pmRigCategory(b('fx1', 'COMP 1'), 'normal'), 'comp');
  assert.equal(pmRigCategory(b('fx2', 'Touch Wah'), 'normal'), 'treadle');
  assert.equal(pmRigCategory(b('fx1', 'Boost'), 'normal'), 'drive');
  assert.equal(pmRigCategory(b('fx2', 'Octave'), 'normal'), 'rack');
  assert.equal(pmRigCategory(b('fx1', 'Phaser'), 'normal'), 'mod');
  assert.equal(pmRigCategory(b('drv', 'Scream'), 'normal'), 'drive');
  assert.equal(pmRigCategory(b('amp', 'TWD Deluxe'), 'normal'), 'combo');
  assert.equal(pmRigCategory(b('amp', 'Brit 800'), 'normal'), 'head');
  assert.equal(pmRigCategory(b('amp', 'User Profile 1'), 'clone'), 'clone');
  assert.equal(pmRigCategory(b('ir', 'BritGN 4x12'), 'normal'), 'cab');
  assert.equal(pmRigCategory(b('ir', 'User IR 2'), 'normal'), 'ir');
  assert.equal(pmRigCategory(b('eq', 'GT EQ 1'), 'normal'), 'eq');
  assert.equal(pmRigCategory(b('dly', 'Pure'), 'normal'), 'delay');
  assert.equal(pmRigCategory(b('rvb', 'Hall'), 'normal'), 'reverb');
});

test("a Pocket Master preset becomes the rig's blocks, switch parameters with their two names", () => {
  const preset = decodePreset(realP08());
  const blocks = pmRigBlocks(preset, (b) => b.model, ['off', 'on']);
  assert.deepEqual(
    blocks.map((b) => b.id),
    preset.chain.map((b) => b.module),
  );
  for (const [i, b] of blocks.entries()) {
    const source = preset.chain[i]!;
    assert.equal(b.module, source.label);
    assert.equal(b.params.length, source.params.length);
    for (const p of b.params) {
      assert.ok(p.min <= p.value && p.value <= p.max, `${b.name} ${p.name}: ${p.value} in ${p.min}..${p.max}`);
      if (p.options) assert.equal(p.options.length, (p.max - p.min) / p.step + 1);
    }
  }
  const amp = preset.chain.find((b) => b.key === 'amp')!;
  const knob = amp.params.find((p) => p.kind === 'number')!;
  assert.equal(pmParamValue(preset, amp.module, knob.alg, knob.value), knob.value);
  assert.equal(pmParamValue(preset, 99, 0, 1), null);
});

test("a Matribox chain becomes the rig's blocks by storage slot, named by position", () => {
  const chain = resolveMbPreset(parseMbPreset(new FakeMatribox().editBuffer), MB_CATALOG).chain;
  const blocks = mbRigBlocks(chain, (b) => b.model?.name ?? '?');
  assert.deepEqual(
    blocks.map((b) => b.id),
    chain.map((b) => b.slot),
  );
  assert.equal(blocks[1]?.name, `2. ${chain[1]?.module}`);
  for (const b of blocks) for (const p of b.params) assert.ok(p.step > 0 && Number.isFinite(p.value));
});
