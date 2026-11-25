import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matriboxLink, mbSetBlockOn, parseMatriboxPrst, parseMbPreset, toHex, writeMatriboxPrst } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { translateError } from '../lib/i18n.ts';
import { backupFromSlot, type MbBackup } from '../lib/matribox.ts';
import { importToSlot, mbPrstFileName, NOT_MB_PRESET, parseMbPresetFile, POCKET_MASTER_PRST } from '../lib/matriboxPresetFile.ts';

const unitLink = (fake: FakeMatribox) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 500);
const bytes = (text: string) => new TextEncoder().encode(text);
const driveAd = () => parseMbPreset(new FakeMatribox().editBuffer);
const sections = (data: Uint8Array, ids: readonly number[]) =>
  parseMbPreset(data)
    .sections.filter((s) => ids.includes(s.id))
    .map((s) => toHex(s.body));
const KEPT = [2, 3, 4, 5, 7, 9];

test('mbPrstFileName is "<label> <name>.prst", without characters a file name cannot hold', () => {
  assert.equal(mbPrstFileName('17C', 'Drive AD'), '17C Drive AD.prst');
  assert.equal(mbPrstFileName('1A', ' A/B: "x" '), '1A A_B_ _x_.prst');
  assert.equal(mbPrstFileName('60D', ''), '60D preset.prst');
});

test('parseMbPresetFile reads a .prst written by writeMatriboxPrst', () => {
  const preset = parseMbPresetFile(bytes(writeMatriboxPrst(driveAd())));
  assert.equal(preset.name, 'Drive AD');
  assert.equal(preset.number, null);
  assert.deepEqual(preset.chain, driveAd().chain);
});

test("parseMbPresetFile reads the editor's backup of one slot", () => {
  const data = new FakeMatribox().editBuffer;
  const backup = backupFromSlot(66, data, '2026-11-24T10:00:00.000Z');
  assert.equal(parseMbPresetFile(bytes(JSON.stringify(backup))).name, 'Drive AD');
});

test('parseMbPresetFile says so for a Pocket Master .prst', () => {
  const file = new Uint8Array(515);
  file.set(bytes('Pocket Master'));
  assert.throws(() => parseMbPresetFile(file), { message: POCKET_MASTER_PRST });
});

test('parseMbPresetFile refuses anything else with one clear message', () => {
  const refused = [
    'hello',
    '',
    '{"format":"opensonicx-matribox-backup","presets":[]}',
    '{"device":"Sonicake Matribox II Pro","preset":"00 01"}',
    '{"device":"Sonicake Matribox II Pro"}',
    '{nope',
    btoa('[1,2,3]'),
    writeMatriboxPrst(driveAd()).slice(0, 400),
  ];
  for (const text of refused) assert.throws(() => parseMbPresetFile(bytes(text)), { message: NOT_MB_PRESET }, text.slice(0, 30));
});

test('the refusals are shown in the UI language', () => {
  assert.match(translateError('pt', NOT_MB_PRESET), /^Este não é um arquivo de preset da Matribox/);
  assert.match(translateError('pt', POCKET_MASTER_PRST), /^Este é um arquivo \.prst do Pocket Master/);
  assert.match(translateError('en', POCKET_MASTER_PRST), /^This is a Pocket Master \.prst file/);
});

test('importToSlot loads the target, keeps what it stores, writes the preset whole and leaves the slot loaded', async () => {
  const fake = new FakeMatribox();
  const link = unitLink(fake);
  const before = fake.editBuffer;
  await link.write(mbSetBlockOn(0, !parseMbPreset(before).chain.find((b) => b.slot === 0)?.on)); // an unsaved edit, not part of the file
  const kept: MbBackup[] = [];
  const backup = await importToSlot(
    link,
    5,
    parseMatriboxPrst(writeMatriboxPrst(driveAd())),
    (b) => void kept.push(b),
    () => '2026-11-24T10:00:00.000Z',
  );
  assert.deepEqual(kept, [backup]);
  assert.deepEqual([backup.label, backup.name, backup.source], ['2B', '', 'slot']); // what 2B stored, not the loaded preset
  assert.equal(fake.current, 5);
  assert.equal(fake.presetWrites.length, 1);
  assert.deepEqual(sections(fake.stored(5) as Uint8Array, KEPT), sections(before, KEPT));
  assert.equal(parseMbPreset(fake.stored(5) as Uint8Array).name, 'Drive AD');
});

test('importToSlot fails when the unit does not hold the preset after the write; the backup was kept first', async () => {
  const fake = new FakeMatribox();
  fake.dropsPresetWriteTo = 5;
  const kept: string[] = [];
  // The fake's empty slots hold Drive AD's sound without its name: the file must differ from it.
  const other = { ...driveAd(), sections: driveAd().sections.map((s) => (s.id === 5 ? { ...s, body: s.body.map((b, i) => (i === 730 ? b ^ 1 : b)) } : s)) };
  await assert.rejects(
    importToSlot(unitLink(fake), 5, other, (b) => void kept.push(b.label)),
    /2B differs from "Drive AD"/,
  );
  assert.deepEqual(kept, ['2B']);
});

test('importToSlot sends nothing for a slot that does not exist', async () => {
  const fake = new FakeMatribox();
  await assert.rejects(
    importToSlot(unitLink(fake), 240, driveAd(), () => undefined),
    RangeError,
  );
  assert.deepEqual(fake.received, []);
});
