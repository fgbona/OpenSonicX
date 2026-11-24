import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbCatalog, parseMbPreset, type MbPreset } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_ALG_DATA } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { askedToSaveMb, matriboxAgent, type MbAgentHost } from '../lib/matriboxAgent.ts';
import { requestTexts } from '../lib/assistant.ts';

const catalog = parseMbCatalog(FAKE_ALG_DATA);

/** A host over plain state: apply sets the chain (slots in order), undo goes back one apply. */
function host() {
  let preset: MbPreset = parseMbPreset(new FakeMatribox().editBuffer);
  let current = 66;
  const past: MbPreset[] = [];
  const saves: [number, string][] = [];
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
  };
  return {
    h,
    saves,
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
  assert.match(r.text, /^Name: Drive AD\nChain: DRV → AMP\n1\. DRV on Fake Fuzz \(based on Imaginary Fuzz Face\): Fuzz 80/);
  assert.equal(agent.acts.has('build_tone'), true);
  const changes = watch({ loaded: false, saved: false })!;
  assert.deepEqual(changes[0], { what: 'order', from: 'DYN DRV AMP CAB RVB VOL', to: 'DRV AMP' });

  const bad = await run('build_tone', { blocks: [{ module: 'DRV', model: 'Nope' }] });
  assert.deepEqual([bad.ok, bad.text], [false, 'Error: No DRV model "Nope". Models: Fake Drive, Fake Fuzz']);
  assert.equal(s.preset().chain.length, 2); // nothing sent
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
