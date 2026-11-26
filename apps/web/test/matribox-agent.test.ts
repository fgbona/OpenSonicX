import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matriboxLink, mbAssignments, parseMbPreset, type MbPreset } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_CATALOG } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { askedToSaveMb, matriboxAgent, type MbAgentHost } from '../lib/matriboxAgent.ts';
import { requestTexts } from '../lib/assistant.ts';
import { mbTone, withTone, type MbTone } from '../lib/matriboxLibrary.ts';

const catalog = FAKE_CATALOG;

/** A host over plain state: apply sets the chain (slots in order), undo goes back one apply. */
function host() {
  const fake = new FakeMatribox();
  const unit = matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 1000);
  let preset: MbPreset = parseMbPreset(fake.editBuffer);
  const sent: Uint8Array[] = [];
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
    assign: async (frames) => {
      for (const frame of frames) {
        sent.push(frame);
        await unit.write(frame);
      }
      preset = parseMbPreset(fake.editBuffer);
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
    sent,
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

test('set_controls makes the tone live-ready: EXP on a parameter, a footswitch on a block, a quick knob on a gain', async () => {
  const s = host();
  const run = matriboxAgent(s.h).runner();
  const before = await run('get_controls', {});
  assert.match(before.text, /^Footswitch A: CTRL 1 \(toggles 1 DYN\)$/m);
  assert.match(before.text, /^Quick knob 3: patch volume$/m);
  const r = await run('set_controls', {
    changes: [
      { kind: 'expression', entry: 4, block: 'DRV', parameter: 'Tone', min: 10, max: 90 },
      { kind: 'footswitch', footswitch: 'B', block: 'RVB' },
      { kind: 'quick_knob', knob: 1, target: 'DRV', parameter: 'gain' },
      { kind: 'footswitch_function', footswitch: 'D', function: 'tap tempo' },
    ],
  });
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /^Expression entry 4: 2 DRV Tone, 10\.\.90 %$/m);
  assert.match(r.text, /^Footswitch B: CTRL 2 \(toggles .*5 RVB.*\)$/m);
  assert.match(r.text, /^Quick knob 1: 2 DRV Gain$/m);
  assert.match(r.text, /^Footswitch D: tap tempo$/m);
  const a = mbAssignments(s.preset());
  assert.deepEqual(a.expression[3], { entry: 3, slot: 0, paramId: 1, min: 10, max: 90 });
  assert.equal(a.footswitches[3]?.press, 8);
});

test('set_controls checks every change before sending anything', async () => {
  const s = host();
  const run = matriboxAgent(s.h).runner();
  for (const [changes, message] of [
    [
      [
        { kind: 'quick_knob', knob: 1, target: 'BPM' },
        { kind: 'expression', entry: 1, block: 'DRV', parameter: 'Tone', min: 80, max: 20 },
      ],
      /min \(80\) must not be above max/,
    ],
    [[{ kind: 'ctrl', ctrl: 5, block: 'DRV' }], /ctrl must be 1\.\.4/],
    [[{ kind: 'footswitch', footswitch: 'E', block: 'DRV' }], /footswitch must be A, B, C or D/],
    [[{ kind: 'footswitch_function', footswitch: 'A', function: 'boost' }], /no footswitch function "boost"/],
    [[{ kind: 'quick_knob', knob: 2, target: 'DLY' }], /No block "DLY"/],
    [[{ kind: 'quick_knob', knob: 2, target: 'DRV' }], /name the parameter/],
  ] as const) {
    const r = await run('set_controls', { changes });
    assert.equal(r.ok, false);
    assert.match(r.text, message);
  }
  assert.equal(s.sent.length, 0);
});
