import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbCatalog, parseMbPreset } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_ALG_DATA } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { editChain, planTone, transition, type MbChainBlock } from '../lib/matriboxPlan.ts';

const catalog = parseMbCatalog(FAKE_ALG_DATA);
// Drive AD: DYN Fake Gate, DRV Fake Drive (off), AMP Fake Plexi, CAB unknown, RVB Fake Hall, VOL Volume.
const loaded = (): readonly MbChainBlock[] => parseMbPreset(new FakeMatribox().editBuffer).chain;
const values = (set: Record<number, number>) => Array.from({ length: 15 }, (_, i) => set[i] ?? 0);

test('planTone checks a whole tone against the catalog and fills the defaults', () => {
  const chain = planTone(catalog, [
    { module: 'drv', model: 'fake fuzz', params: [{ name: 'Fuzz', value: 70 }] },
    { module: 'DLY', model: 'Fake Echo', on: false },
  ]);
  assert.deepEqual(
    chain.map((b) => [b.moduleIndex, b.fxid, b.on]),
    [
      [3, 0x03000010, true],
      [9, 0x0b000001, false],
    ],
  );
  assert.equal(chain[0]!.values[0], 70);
  assert.equal(chain[1]!.values[1], 20); // Time's default (its minimum)
  assert.throws(() => planTone(catalog, [{ module: 'DRV', model: 'Fake Plexi' }]), /No DRV model "Fake Plexi". Models: Fake Drive, Fake Fuzz/);
  assert.throws(() => planTone(catalog, [{ module: 'DRV', model: 'Fake Fuzz', params: [{ name: 'Fuzz', value: 101 }] }]), /Fuzz must be 0..100, got 101/);
  assert.throws(() => planTone(catalog, [{ module: 'DRV', model: 'Fake Fuzz', params: [{ name: 'Gain', value: 1 }] }]), /Fake Fuzz has no parameter "Gain". Parameters: Fuzz, Level/);
  assert.throws(() => planTone(catalog, []), /at least 1 and at most 12 blocks/);
});

test('editChain applies small edits in order, naming blocks by position or module', () => {
  const chain = editChain(catalog, loaded(), [
    { kind: 'parameter', block: 'DRV', parameter: 'gain', value: 60 },
    { kind: 'block', block: '2', on: true },
    { kind: 'move', block: 'RVB', position: 1 },
    { kind: 'remove', block: 'VOL' },
    { kind: 'add', module: 'DLY', model: 'Fake Echo', params: [{ name: 'Mix', value: 30 }] },
    { kind: 'model', block: 'AMP', model: 'Fake Plexi' },
  ]);
  assert.deepEqual(
    chain.map((b) => b.moduleIndex),
    [10, 0, 3, 4, 5, 9],
  );
  assert.deepEqual([chain[2]!.values[0], chain[2]!.on], [60, true]);
  assert.equal(chain[5]!.values[0], 30);
  assert.throws(() => editChain(catalog, loaded(), [{ kind: 'parameter', block: 'CAB', parameter: 'Volume', value: 1 }]), /unknown model/);
  assert.throws(() => editChain(catalog, loaded(), [{ kind: 'block', block: 'FX', on: true }]), /No block "FX". Chain: 1 DYN, 2 DRV/);
});

test('transition: a knob or switch is one write, by chain position', () => {
  const now = loaded();
  const target = now.map((b, i) => (i === 1 ? { ...b, on: true, values: b.values.map((v, id) => (id === 0 ? 33 : v)) } : b));
  assert.deepEqual(transition(catalog, now, target), [
    { kind: 'param', position: 1, id: 0, value: 33 },
    { kind: 'on', position: 1, on: true },
  ]);
  assert.deepEqual(transition(catalog, now, now), []);
});

test('transition: one chain edit undoes another, and new blocks get every value', () => {
  const now = loaded();
  const echo = { moduleIndex: 9, fxid: 0x0b000001, on: true, values: values({ 0: 30, 1: 500 }) };
  const added = [...now.slice(0, 2), echo, ...now.slice(2)];
  assert.deepEqual(transition(catalog, now, added), [
    { kind: 'add', position: 2, moduleIndex: 9, fxid: 0x0b000001 },
    { kind: 'param', position: 2, id: 0, value: 30 },
    { kind: 'param', position: 2, id: 1, value: 500 },
    { kind: 'on', position: 2, on: true },
  ]);
  assert.deepEqual(transition(catalog, added, now), [{ kind: 'remove', position: 2 }]);
  const moved = [now[4]!, ...now.slice(0, 4), now[5]!];
  assert.deepEqual(transition(catalog, now, moved), [{ kind: 'move', from: 4, to: 0 }]);
  const fuzz = now.map((b, i) => (i === 1 ? { moduleIndex: 3, fxid: 0x03000010, on: false, values: values({ 0: 80, 1: 40 }) } : b));
  assert.deepEqual(transition(catalog, now, fuzz), [
    { kind: 'model', position: 1, moduleIndex: 3, fxid: 0x03000010 },
    { kind: 'param', position: 1, id: 0, value: 80 },
    { kind: 'param', position: 1, id: 1, value: 40 },
    { kind: 'on', position: 1, on: false },
  ]);
});

test('transition: anything else rebuilds the chain from the first block that differs', () => {
  const now = loaded();
  const target = [
    now[0]!,
    ...planTone(catalog, [
      { module: 'DLY', model: 'Fake Echo' },
      { module: 'AMP', model: 'Fake Plexi' },
    ]),
  ];
  const ops = transition(catalog, now, target);
  assert.deepEqual(
    ops.filter((o) => o.kind === 'remove' || o.kind === 'add'),
    [
      { kind: 'remove', position: 5 },
      { kind: 'remove', position: 4 },
      { kind: 'remove', position: 3 },
      { kind: 'remove', position: 2 },
      { kind: 'remove', position: 1 },
      { kind: 'add', position: 1, moduleIndex: 9, fxid: 0x0b000001 },
      { kind: 'add', position: 2, moduleIndex: 4, fxid: 0x0700001a },
    ],
  );
  assert.ok(!ops.some((o) => 'position' in o && o.position === 0)); // the gate stays as it is
});
