import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetFile, parsePresetFile, parsePrstFile, loadIntoEditBuffer } from '../src/preset-file.ts';
import { decodePreset } from '../src/dump.ts';
import { applyEdit, diffPresets } from '../src/edit.ts';
import { modelsFor } from '../src/catalog.ts';
import { fromHex } from '../src/hex.ts';
import { FakePedal, realP08 } from './fake-pedal.ts';
import { readFileSync } from 'node:fs';

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

/** A synthetic .prst as Sonicake's app writes it: magic, one unknown byte, FF x4, 16-byte name, dump without its 12 41. */
function prst(name: string, payload = realP08()): Uint8Array {
  const field = (text: string, size: number) => Array.from({ length: size }, (_, i) => text.charCodeAt(i) || 0);
  return Uint8Array.from([...field('Pocket Master', 20), 0x84, 0xff, 0xff, 0xff, 0xff, ...field(name, 16), ...payload.subarray(2)]);
}

test('parsePrstFile reads a Sonicake app preset into a normal preset file', () => {
  const file = parsePrstFile(prst('IRON-LEAD'), NOW);
  assert.deepEqual(file, presetFile(realP08(), 'IRON-LEAD', NOW));
});

test('parsePrstFile keeps the sound but drops a name the pedal cannot store', () => {
  assert.equal(parsePrstFile(prst('A name too long'), NOW).name, '');
  assert.equal(parsePrstFile(prst(' LEAD'), NOW).name, '');
  assert.deepEqual(fromHex(parsePrstFile(prst('A name too long'), NOW).payload), realP08());
});

test('parsePrstFile rejects files that are not .prst presets or are damaged', () => {
  const good = prst('IRON-LEAD');
  assert.throws(() => parsePrstFile(good.subarray(0, 514)), /not a Pocket Master \.prst file/);
  assert.throws(() => parsePrstFile(Uint8Array.from([...good, 0])), /not a Pocket Master \.prst file/);
  assert.throws(() => parsePrstFile(Uint8Array.from(good, (b, i) => (i === 0 ? 0x41 : b))), /not a Pocket Master \.prst file/);
  assert.throws(() => parsePrstFile(Uint8Array.from(good, (b, i) => (i >= 41 ? 0 : b))), /the \.prst file is damaged/);
});

test("loadIntoEditBuffer turns the edit buffer into the file's preset, checked, without saving", async () => {
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

test('a preset file can carry notes, and files without notes still parse', async () => {
  const { presetFile: make, parsePresetFile: parse } = await import('../src/preset-file.ts');
  const { realP08 } = await import('./fake-pedal.ts');
  const withNotes = make(realP08(), 'BLACK', () => new Date(0), 'Metallica - Black Album rhythm, approved by ear');
  assert.equal(parse(JSON.stringify(withNotes)).notes, 'Metallica - Black Album rhythm, approved by ear');
  const plain = make(realP08(), 'PLAIN', () => new Date(0));
  assert.equal('notes' in plain, false);
  assert.equal(parse(JSON.stringify({ ...plain, notes: 7 })).notes, undefined, 'notes that are not text are dropped');
});

// Format version 1 is frozen for 1.x: these files were written by 0.13 and every later 1.x must read
// them the same way. A change here is a breaking change (a new format version), not a fix.
const V1 = readFileSync(new URL('./fixtures/preset-files/v1-iron-lead.json', import.meta.url), 'utf8');

test('a version 1 file written by 0.13 still reads, with the same preset in it', () => {
  const file = parsePresetFile(V1);
  assert.deepEqual(file, JSON.parse(V1));
  const preset = decodePreset(fromHex(file.payload));
  assert.equal(preset.volume, 65);
  assert.deepEqual(
    preset.chain.map((b) => `${b.label} ${b.model}${b.on ? '' : ' (off)'}`),
    ['NR Gate', 'FX1 Boost (off)', 'DRV Scream', 'AMP Brit 800', 'IR BritGN 4x12', 'EQ GT EQ 1', 'FX2 A-Chorus (off)', 'DLY Analog (off)', 'RVB Plate 2 (off)'],
  );
});

test('the writer still produces version 1 byte for byte', () => {
  const file = presetFile(realP08(), 'IRON-LEAD', NOW, "P08 read from the owner's unit, firmware V1.3.3.");
  assert.equal(`${JSON.stringify(file, null, 2)}\n`, V1);
});

test('fields a later 1.x adds are ignored, so older 1.x readers keep working', () => {
  const later = JSON.stringify({ ...JSON.parse(V1), author: 'someone', tags: ['lead'] });
  assert.deepEqual(parsePresetFile(later), JSON.parse(V1));
});
