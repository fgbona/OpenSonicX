import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetFile, parsePresetFile, loadIntoEditBuffer } from '../src/preset-file.ts';
import { decodePreset } from '../src/dump.ts';
import { applyEdit, diffPresets } from '../src/edit.ts';
import { modelsFor } from '../src/catalog.ts';
import { fromHex } from '../src/hex.ts';
import { FakePedal, realP08 } from './fake-pedal.ts';

const NOW = () => new Date('2026-11-18T22:30:00Z');

test('presetFile keeps the raw dump, the name and when it was made', () => {
  const file = presetFile(realP08(), 'IRON-LEAD', NOW);
  assert.equal(file.format, 'pocket-master-preset');
  assert.equal(file.version, 1);
  assert.equal(file.name, 'IRON-LEAD');
  assert.equal(file.createdAt, '2026-11-18T22:30:00.000Z');
  assert.deepEqual(fromHex(file.payload), realP08());
});

test('parsePresetFile round-trips a written file and rejects anything else', () => {
  const file = presetFile(realP08(), 'IRON-LEAD', NOW);
  assert.deepEqual(parsePresetFile(JSON.stringify(file)), file);
  assert.throws(() => parsePresetFile('not json'), /not a Pocket Master preset file/);
  assert.throws(() => parsePresetFile('{"format":"pocket-master-backup","version":1}'), /not a Pocket Master preset file/);
  assert.throws(() => parsePresetFile(JSON.stringify({ ...file, payload: '1243' })), /damaged/);
  assert.throws(() => parsePresetFile(JSON.stringify({ ...file, name: 'Way too long' })), /damaged/);
  assert.throws(() => parsePresetFile(JSON.stringify({ ...file, createdAt: 'yesterday' })), /not a Pocket Master preset file/);
});

test('loadIntoEditBuffer turns the edit buffer into the file\'s preset, checked, without saving', async () => {
  const pedal = new FakePedal();
  const butter = modelsFor('drv').find((m) => m.name === 'Butter OD')!;
  const other = [
    { kind: 'model', module: 2, code: butter.code },
    { kind: 'param', module: 3, alg: 4, value: 12 },
    { kind: 'on', module: 7, on: true },
    { kind: 'volume', value: 44 },
  ].reduce((p, e) => applyEdit(p, e as never), decodePreset(realP08()));
  const before = pedal.slots.map((s) => s.slice());
  const loaded = await loadIntoEditBuffer(pedal, other);
  assert.equal(diffPresets(decodePreset(pedal.editBuffer), other).length, 0, 'edit buffer holds the imported preset');
  assert.equal(diffPresets(loaded, other).length, 0);
  assert.deepEqual(pedal.slots, before, 'no slot was written');
  assert.ok(!pedal.received.some((r) => r.startsWith('select') || r.startsWith('save')), 'no selection, no save');
});

test('loadIntoEditBuffer refuses a preset with a model the editor does not know', async () => {
  const pedal = new FakePedal();
  const unknown = applyEdit(decodePreset(realP08()), { kind: 'model', module: 2, code: 0x03ffffff });
  await assert.rejects(loadIntoEditBuffer(pedal, unknown), /DRV uses model 0x03FFFFFF/);
  assert.deepEqual(pedal.received, []);
});
