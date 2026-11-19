import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelsFor } from '../src/catalog.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { modelChoices, parsePresetLabel, resolveBlock, resolveModel, resolveParam } from '../src/resolve.ts';
import { realP08 } from './fake-pedal.ts';

const p08 = (): Preset => decodePreset(realP08());
const names = { irNames: ['Mesa OS', null, null, null, null], profileNames: ['Randall SA', null, null, null, null] };

test('a block is found by its label or key, in any case', () => {
  assert.equal(resolveBlock(p08(), 'AMP').module, 3);
  assert.equal(resolveBlock(p08(), 'dly').module, 7);
  assert.equal(resolveBlock(p08(), ' Fx1 ').module, 1);
});

test('an unknown block fails and lists the blocks', () => {
  assert.throws(() => resolveBlock(p08(), 'chorus'), /No block "chorus"\. Blocks: NR, FX1, .*RVB/);
});

test('a parameter is found by exact name or unique prefix of the current model', () => {
  const amp = resolveBlock(p08(), 'amp');
  assert.equal(resolveParam(p08(), amp, 'gain').name, 'Gain');
  assert.equal(resolveParam(p08(), amp, 'GA').name, 'Gain');
});

test('an ambiguous prefix fails and names the candidates instead of guessing', () => {
  const eq = resolveBlock(p08(), 'eq');
  assert.throws(() => resolveParam(p08(), eq, '1'), /"1" matches several parameters: .*1/);
});

test('a model is found by catalog name, case and spacing ignored', () => {
  const brit = modelsFor('amp').find((m) => m.name === 'Brit 800')!;
  assert.deepEqual(resolveModel('amp', 'brit 800', names), { name: 'Brit 800', code: brit.code, clone: false });
  assert.equal(resolveModel('drv', 'butterod', names).name, 'Butter OD');
});

test('a user IR is found by the name of the file loaded in its slot', () => {
  assert.deepEqual(resolveModel('ir', 'mesa os', names), { name: 'Mesa OS (User IR 1)', code: 0x0a100000, clone: false });
  assert.equal(resolveModel('ir', 'User IR 1', names).code, 0x0a100000);
});

test('a captured profile is an AMP choice, by its name, and selects clone mode', () => {
  const choice = resolveModel('amp', 'randall', names);
  assert.equal(choice.clone, true);
  assert.equal(choice.code, 0x07000000);
  assert.equal(choice.name, 'Randall SA (profile 1)');
});

test('empty profile slots are not offered', () => {
  assert.throws(() => resolveModel('amp', 'User Profile 2', names), /No AMP model "User Profile 2"/);
  assert.equal(modelChoices('amp', names).filter((c) => c.clone).length, 1);
});

test('without slot names, user IRs keep their catalog names and no profile is offered', () => {
  const none = { irNames: null, profileNames: null };
  assert.equal(resolveModel('ir', 'User IR 2', none).code, 0x0a100001);
  assert.equal(modelChoices('amp', none).some((c) => c.clone), false);
});

test('preset labels parse to indexes', () => {
  assert.equal(parsePresetLabel('P01'), 0);
  assert.equal(parsePresetLabel('p9'), 8);
  assert.equal(parsePresetLabel('P50'), 49);
  assert.equal(parsePresetLabel('F01'), 50);
  assert.throws(() => parsePresetLabel('P51'), /P01..P50 or F01..F50/);
  assert.throws(() => parsePresetLabel('9'), /P01..P50 or F01..F50/);
});
