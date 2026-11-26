import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbPreset, type MbPreset } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_CATALOG } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { askedToSaveMb, matriboxAgent, type MbAgentHost } from '../lib/matriboxAgent.ts';
import { requestTexts } from '../lib/assistant.ts';
import { mbTone, withTone, type MbTone } from '../lib/matriboxLibrary.ts';

const catalog = FAKE_CATALOG;

/** A host over plain state: apply sets the chain (slots in order), undo goes back one apply. */
function host() {
  let preset: MbPreset = parseMbPreset(new FakeMatribox().editBuffer);
  let current = 66;
  const past: MbPreset[] = [];
  const saves: [number, string][] = [];
  let tones: MbTone[] = [];
  const h: MbAgentHost = {
    snapshot: () => ({ current, preset, catalog }),
    apply: async (chain) => {
      past.push(preset);
      preset = { ...preset, chain: chain.map((b, slot) => ({ ...b, slot })) };
      return preset;
    },
    undo: async () => {
      const last = past.pop();
      if (last) preset = last;
      return last !== undefined;
    },
    proposeSave: async (index, name) => {
      saves.push([index, name]);
      return 'saved';
    },
    tones: () => tones,
    keepTone: async (name, notes) => {
      tones = withTone(tones, mbTone(preset, name, notes, `kept-${tones.length}`));
    },
  };
  return {
    h,
    saves,
    tones: () => tones,
    load: (n: number) => {
      current = n;
    },
    preset: () => preset,
  };
}

test('the first message carries the catalog and the loaded preset; later ones the preset only', () => {
  const agent = matriboxAgent(host().h);
  const first = requestTexts(agent, [], 'Black Album', 'English').first;
  assert.match(first, /^Loaded preset:\nName: Drive AD/);
  assert.match(first, /Models by module/);
  assert.match(first, /DRV: Fake Drive \(Imaginary Overdrive 808\)/);
  assert.match(first, /Request: Black Album\n\nAnswer in English\.$/);
  assert.doesNotMatch(first, /Time 20\.\.2000/);
  assert.match(agent.context(true), /Time 20\.\.2000/);
  assert.match(agent.instructions(false), /Matribox II Pro/);
  assert.ok(agent.instructions(true).length > agent.instructions(false).length);
});

test('build_tone replaces the chain in one step and answers with the preset as it now is', async () => {
  const s = host();
  const agent = matriboxAgent(s.h);
  const run = agent.runner();
  const watch = agent.watch('off');
  const r = await run('build_tone', {
    blocks: [
      { module: 'DRV', model: 'Fake Fuzz', params: [{ name: 'Fuzz', value: 80 }] },
      { module: 'AMP', model: 'Fake Plexi' },
    ],
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /^Name: Drive AD\nChain: DRV → AMP\nDSP load \(estimate from the block types\): 18% of the unit's budget\n1\. DRV on Fake Fuzz \(based on Imaginary Fuzz Face\): Fuzz 80/);
  assert.equal(agent.acts.has('build_tone'), true);
  const changes = watch({ loaded: false, saved: false })!;
  assert.deepEqual(changes[0], { what: 'order', from: 'DYN DRV AMP CAB RVB VOL', to: 'DRV AMP' });

  const bad = await run('build_tone', { blocks: [{ module: 'DRV', model: 'Nope' }] });
  assert.deepEqual([bad.ok, bad.text], [false, 'Error: No DRV model "Nope". Models: Fake Drive, Fake Fuzz']);
  assert.equal(s.preset().chain.length, 2); // nothing sent
});

test('build_tone and edit_preset refuse a chain past the estimated DSP, sending nothing, and warn near it', async () => {
  const s = host();
  const run = matriboxAgent(s.h).runner();
  const before = s.preset();
  const amps = (n: number) => Array.from({ length: n }, () => ({ module: 'AMP', model: 'Fake Plexi' }));
  const heavy = await run('build_tone', { blocks: amps(11) }); // 11 x ~10%
  assert.equal(heavy.ok, false);
  assert.match(heavy.text, /^Error: the chain would be past the unit's DSP: estimated DSP load 110%.*heaviest: AMP ~10%/);
  assert.equal(s.preset(), before);
  const memory = await run('edit_preset', {
    changes: [
      { kind: 'add', module: 'CLONE', model: 'Clone 1' },
      { kind: 'add', module: 'IR', model: 'User IR 1' },
    ],
  });
  assert.equal(memory.ok, false);
  assert.match(memory.text, /3 CAB\/IR\/CLONE blocks; the Matribox II Pro has memory for 2/);
  assert.equal(s.preset(), before);
  const near = await run('build_tone', { blocks: amps(9) });
  assert.equal(near.ok, true);
  assert.match(near.text, /DSP load \(estimate from the block types\): 90%/);
  assert.match(near.text, /\n\nNote: estimated DSP load 90% .*near the unit's limit/);
  assert.match(matriboxAgent(s.h).instructions(false), /System overloaded/);
});

test('edit_preset, undo_edit, list_models and get_preset', async () => {
  const s = host();
  const run = matriboxAgent(s.h).runner();
  const r = await run('edit_preset', { changes: [{ kind: 'parameter', block: 'AMP', parameter: 'Gain', value: 65 }] });
  assert.match(r.text, /AMP on Fake Plexi \(based on Imaginary Plexi 50W\): Gain 65/);
  assert.match((await run('undo_edit', {})).text, /Gain 30/);
  assert.deepEqual(await run('undo_edit', {}), { ok: false, text: 'Error: there is nothing to undo.' });
  assert.match((await run('list_models', { modules: ['DLY'] })).text, /Time 20\.\.2000 \(default 20\)/);
  assert.match((await run('get_preset', {})).text, /^Name: Drive AD/);
  assert.deepEqual(await run('nope', {}), { ok: false, text: 'Error: unknown tool "nope"' });
});

test('save_preset only proposes the Save dialog, for a checked label and name', async () => {
  const s = host();
  const run = matriboxAgent(s.h).runner();
  assert.match((await run('save_preset', { slot: '12a', name: 'Black Album' })).text, /saved it to 12A "Black Album"/);
  assert.deepEqual(s.saves, [[44, 'Black Album']]);
  assert.equal((await run('save_preset', { slot: '61A', name: 'x' })).ok, false);
  assert.equal((await run('save_preset', { slot: '1A', name: 'Ação' })).ok, false);
});

test('once the person loads another preset, the tools refuse to change it until get_preset', async () => {
  const s = host();
  const agent = matriboxAgent(s.h);
  const run = agent.runner();
  const watch = agent.watch('off');
  s.load(3);
  const refused = await run('edit_preset', { changes: [{ kind: 'block', block: 'DRV', on: true }] });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /changed to 1D/);
  assert.equal(watch({ loaded: false, saved: false }), undefined);
  await run('get_preset', {});
  assert.equal((await run('edit_preset', { changes: [{ kind: 'block', block: 'DRV', on: true }] })).ok, true);
});

test('a message asking to save in a slot opens the Save dialog itself', () => {
  assert.equal(askedToSaveMb('salva no 12A'), 44);
  assert.equal(askedToSaveMb('save it to 1d please'), 3);
  assert.equal(askedToSaveMb('more gain on 12A'), null);
  assert.equal(askedToSaveMb('save it to 61A'), null);
  const s = host();
  assert.equal(matriboxAgent(s.h).offerSave('grave no 2B'), '2B');
  assert.deepEqual(s.saves, [[5, 'Drive AD']]);
});

test('keep_tone keeps the sound, the next first message lists it, and load_saved_tone brings it back as one step', async () => {
  const s = host();
  const agent = matriboxAgent(s.h);
  const run = agent.runner();
  assert.equal((await run('list_saved_tones', {})).text, 'No tones kept yet.');
  assert.doesNotMatch(agent.context(false), /Saved tones/);
  const kept = await run('keep_tone', { name: 'AD Crunch', notes: 'AC/DC, rhythm' });
  assert.equal(kept.ok, true);
  assert.deepEqual(
    s.tones().map((t) => [t.name, t.notes]),
    [['AD Crunch', 'AC/DC, rhythm']],
  );
  assert.match(agent.context(false), /Saved tones \(load_saved_tone\):\n- AD Crunch: AC\/DC, rhythm \[.*Imaginary Overdrive 808/);
  const original = s.preset().chain;
  await run('build_tone', { blocks: [{ module: 'AMP', model: 'Fake Plexi' }] });
  assert.equal(s.preset().chain.length, 1);
  const loaded = await run('load_saved_tone', { name: 'ad crunch' });
  assert.equal(loaded.ok, true);
  assert.match(loaded.text, /^Loaded the kept tone "AD Crunch"\.\n\nName: Drive AD/);
  assert.deepEqual(
    s.preset().chain.map((b) => [b.moduleIndex, b.fxid, b.on]),
    original.map((b) => [b.moduleIndex, b.fxid, b.on]),
  );
  assert.equal(agent.acts.has('load_saved_tone') && agent.acts.has('keep_tone'), true);
  const missing = await run('load_saved_tone', { name: 'Nope' });
  assert.equal(missing.ok, false);
  assert.match(missing.text, /no kept tone is called "Nope"\. Kept tones:\n- AD Crunch/);
  assert.equal((await run('keep_tone', { name: 'Way too long for a preset', notes: '' })).ok, false);
});
