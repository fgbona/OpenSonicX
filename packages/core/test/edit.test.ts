import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame } from '../src/frame.ts';
import { Reassembler } from '../src/reassembler.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { applyEdit, editToCommands, diffPresets, type Edit } from '../src/edit.ts';
import { setAmpMode, selectModel, setParam, setBlockOn, setChain } from '../src/commands.ts';
import { toHex } from '../src/hex.ts';
import { modelsFor } from '../src/catalog.ts';

const BUTTER = modelsFor('drv').find((m) => m.name === 'Butter OD')!;
import { readCapture } from './capture.ts';

function p08(): Preset {
  const r = new Reassembler();
  const frames = readCapture('p08-capture.txt').filter((m) => m.dir === 'RX').slice(1);
  return decodePreset(frames.map((m) => r.feed(parseFrame(m.bytes), 0)).at(-1)!.payload);
}
const block = (p: Preset, key: string) => p.chain.find((b) => b.key === key)!;
const param = (p: Preset, key: string, name: string) => block(p, key).params.find((x) => x.name === name)!;
/** What the pedal holds: order, on/off, models, parameter values, amp mode. */
const sound = (p: Preset) =>
  JSON.stringify([p.ampMode, p.chain.map((b) => [b.module, b.on, b.code, b.params.map((x) => [x.name, x.value])])]);
const hex = (cmds: Uint8Array[]) => cmds.map(toHex);

test('decoded params carry their slot (alg)', () => {
  assert.equal(param(p08(), 'amp', 'Middle').alg, 4);
});

test('applyEdit changes one parameter and leaves the original untouched', () => {
  const before = p08();
  const after = applyEdit(before, { kind: 'param', module: 3, alg: 4, value: 80 });
  assert.equal(param(after, 'amp', 'Middle').value, 80);
  assert.equal(param(after, 'amp', 'Middle').display, '80');
  assert.equal(param(before, 'amp', 'Middle').value, 71);
});

test('applyEdit toggles a block', () => {
  const after = applyEdit(p08(), { kind: 'on', module: 7, on: true });
  assert.equal(block(after, 'dly').on, true);
});

test('applyEdit on a model change loads the catalog defaults', () => {
  const after = applyEdit(p08(), { kind: 'model', module: 2, code: BUTTER.code });
  assert.equal(block(after, 'drv').model, 'Butter OD');
  assert.equal(block(after, 'drv').code, BUTTER.code);
  assert.deepEqual(
    block(after, 'drv').params.map((x) => [x.name, x.value]),
    BUTTER.params.map((s) => [s.name, s.default]),
  );
});

test('applyEdit reorders the chain', () => {
  const order = [2, 3, 4, 5, 0, 7, 8, 1, 6];
  const after = applyEdit(p08(), { kind: 'chain', order });
  assert.deepEqual(after.chain.map((b) => b.module), order);
});

test('editToCommands builds the matching set commands', () => {
  const p = p08();
  assert.deepEqual(hex(editToCommands(p, { kind: 'param', module: 3, alg: 4, value: 80 })), hex([setParam(3, 4, 80)]));
  assert.deepEqual(hex(editToCommands(p, { kind: 'on', module: 7, on: true })), hex([setBlockOn(7, true)]));
  assert.deepEqual(hex(editToCommands(p, { kind: 'model', module: 2, code: BUTTER.code })), hex([selectModel(2, BUTTER.code)]));
  const order = [2, 3, 4, 5, 0, 7, 8, 1, 6];
  assert.deepEqual(hex(editToCommands(p, { kind: 'chain', order })), hex([setChain(order)]));
});

test('editToCommands switches amp mode before selecting an amp model in clone mode', () => {
  const clone: Preset = { ...p08(), ampMode: 'clone' };
  const amp = block(p08(), 'amp').code;
  assert.deepEqual(hex(editToCommands(clone, { kind: 'model', module: 3, code: amp })), hex([setAmpMode(false), selectModel(3, amp)]));
});

test('editToCommands refuses a model change on NR and an invalid chain', () => {
  assert.throws(() => editToCommands(p08(), { kind: 'model', module: 0, code: 27 }), /single model/);
  assert.throws(() => editToCommands(p08(), { kind: 'chain', order: [0, 1, 3, 2, 4, 5, 6, 7, 8] }), /together/);
});

test('diffPresets of a preset with itself is empty', () => {
  assert.deepEqual(diffPresets(p08(), p08()), []);
});

test('diffPresets restores the original after edits, model before its params', () => {
  const original = p08();
  const edits: Edit[] = [
    { kind: 'param', module: 3, alg: 4, value: 80 },
    { kind: 'model', module: 2, code: BUTTER.code },
    { kind: 'on', module: 7, on: true },
    { kind: 'chain', order: [2, 3, 4, 5, 0, 7, 8, 1, 6] },
  ];
  const edited = edits.reduce(applyEdit, original);
  const revert = diffPresets(edited, original);
  assert.equal(revert[0]?.kind, 'chain');
  const model = revert.findIndex((e) => e.kind === 'model' && e.module === 2);
  const drvParam = revert.findIndex((e) => e.kind === 'param' && e.module === 2);
  assert.ok(model >= 0 && drvParam > model, 'model is restored before its parameters');
  assert.equal(sound(revert.reduce(applyEdit, edited)), sound(original));
});

test('a model code missing from the catalog is still applied and sent, with no parameters', () => {
  const unknown = 0x03ffffff;
  const after = applyEdit(p08(), { kind: 'model', module: 2, code: unknown });
  assert.equal(block(after, 'drv').model, '0x03FFFFFF');
  assert.deepEqual(block(after, 'drv').params, []);
  assert.deepEqual(hex(editToCommands(p08(), { kind: 'model', module: 2, code: unknown })), hex([selectModel(2, unknown)]));
  // Revert to a preset whose model the catalog does not know must not throw.
  assert.doesNotThrow(() => diffPresets(p08(), after));
  assert.doesNotThrow(() => diffPresets(after, p08()));
});

test('preset volume is an edit, sent with setPresetVolume and restored by diff', async () => {
  const { setPresetVolume } = await import('../src/slots.ts');
  const louder = applyEdit(p08(), { kind: 'volume', value: 80 });
  assert.equal(louder.volume, 80);
  assert.deepEqual(hex(editToCommands(p08(), { kind: 'volume', value: 80 })), hex([setPresetVolume(80)]));
  assert.deepEqual(diffPresets(louder, p08()), [{ kind: 'volume', value: 65 }]);
});

test('choosing a captured profile switches amp mode on and selects it in module 9', () => {
  const profile = modelsFor('clone')[0]!;
  const edit = { kind: 'model', module: 3, code: profile.code, clone: true } as const;
  assert.deepEqual(hex(editToCommands(p08(), edit)), hex([setAmpMode(true), selectModel(9, profile.code)]));
  const after = applyEdit(p08(), edit);
  assert.equal(after.ampMode, 'clone');
  assert.equal(block(after, 'amp').model, profile.name);
});
