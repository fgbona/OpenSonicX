import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupAllSlots, saveToSlot, restoreFromBackup, parseBackupFile, type BackupFile } from '../src/backup.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { applyEdit, diffPresets, editToCommands, type Edit } from '../src/edit.ts';
import { modelsFor } from '../src/catalog.ts';
import { fromHex } from '../src/hex.ts';
import { FakePedal } from './fake-pedal.ts';

const BUTTER = modelsFor('drv').find((m) => m.name === 'Butter OD')!;
/** Live edits on the loaded P09, sent to the pedal as live edit does: a parameter, a model, the volume. */
function edited(pedal: FakePedal): Preset {
  const edits: Edit[] = [
    { kind: 'param', module: 3, alg: 4, value: 80 },
    { kind: 'model', module: 2, code: BUTTER.code },
    { kind: 'volume', value: 77 },
  ];
  return edits.reduce((p, e) => {
    void pedal.sendEdits(editToCommands(p, e));
    return applyEdit(p, e);
  }, decodePreset(pedal.editBuffer));
}
const same = (a: Preset, b: Preset) => diffPresets(a, b).length === 0;
const slotPreset = (file: BackupFile, index: number) => decodePreset(fromHex(file.slots.find((s) => s.index === index)!.payload));

test('backupAllSlots reads the 50 user slots and puts the edits back on the loaded preset', async () => {
  const pedal = new FakePedal();
  const mine = edited(pedal);
  const file = await backupAllSlots(pedal, { edited: mine });
  assert.equal(file.kind, 'session');
  assert.equal(file.slots.length, 50);
  assert.deepEqual(file.slots.slice(0, 2).map((s) => [s.label, s.name]), [['P01', 'MTL-CLEAN'], ['P02', 'MTL-RHY']]);
  file.slots.forEach((s) => assert.equal(slotPreset(file, s.index).volume, s.index, `slot ${s.label}`));
  assert.equal(pedal.current, 8, 'back on the original preset');
  assert.ok(same(decodePreset(pedal.editBuffer), mine), 'edits restored in the edit buffer');
});

test('backupAllSlots stops when the pedal loads a different slot than asked', async () => {
  const pedal = new FakePedal({ wrongSelect: true });
  await assert.rejects(backupAllSlots(pedal, { edited: null }), /asked for P01 but the pedal loaded P02/);
});

test('saveToSlot takes the session and target backups first, saves, and verifies', async () => {
  const pedal = new FakePedal();
  const mine = edited(pedal);
  const before = pedal.slots[2]!.slice();
  const backups: BackupFile[] = [];
  const result = await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: mine, sessionBackup: null, onBackup: (f) => backups.push(f) });
  assert.deepEqual(backups.map((b) => b.kind), ['session', 'slot']);
  assert.deepEqual(fromHex(backups[1]!.slots[0]!.payload), before, 'target backup is the old slot content');
  assert.equal(backups[1]!.slots[0]!.name, 'MTL-LEAD');
  assert.ok(same(decodePreset(pedal.slots[2]!), mine), 'slot holds the edited preset');
  assert.equal(pedal.names[2], 'My Lead');
  assert.ok(same(result.saved, mine));
  assert.equal(result.sessionBackup.kind, 'session');
});

test('saveToSlot reuses an existing session backup', async () => {
  const pedal = new FakePedal();
  const session = await backupAllSlots(pedal, { edited: null });
  const selectsBefore = pedal.received.filter((r) => r.startsWith('select')).length;
  await saveToSlot(pedal, { target: 8, name: 'P09 v2', edited: edited(pedal), sessionBackup: session });
  const selects = pedal.received.filter((r) => r.startsWith('select')).length - selectsBefore;
  assert.ok(selects <= 3, `only the target backup and the verify select (got ${selects})`);
});

test('a failed acknowledge is reported and never counted as saved', async () => {
  const pedal = new FakePedal({ nack: true });
  const before = pedal.slots[2]!.slice();
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: edited(pedal), sessionBackup: null }), /reported that the save failed/);
  assert.deepEqual(pedal.slots[2], before);
});

test('a missing acknowledge fails the save', async () => {
  const pedal = new FakePedal({ noAck: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: edited(pedal), sessionBackup: null }), /no acknowledge/);
});

test('a factory target or a bad name is refused before anything is sent', async () => {
  for (const [target, name] of [[50, 'x'], [2, 'Way too long'], [2, '']] as const) {
    const pedal = new FakePedal();
    await assert.rejects(saveToSlot(pedal, { target, name, edited: null, sessionBackup: null }));
    assert.deepEqual(pedal.received, [], `nothing sent for ${target} "${name}"`);
  }
});

test('a backup failure stops the save before it is written', async () => {
  const pedal = new FakePedal({ wrongSelect: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: null, sessionBackup: null }));
  assert.ok(!pedal.received.some((r) => r.startsWith('save')));
});

test('restoreFromBackup writes a backed-up slot back, after backing up what is there now', async () => {
  const pedal = new FakePedal();
  const backups: BackupFile[] = [];
  const { sessionBackup } = await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal), sessionBackup: null, onBackup: (f) => backups.push(f) });
  const original = backups[1]!; // slot backup of P03 before the save
  await restoreFromBackup(pedal, original.slots[0]!, { sessionBackup, onBackup: (f) => backups.push(f) });
  assert.ok(same(decodePreset(pedal.slots[2]!), slotPreset(original, 2)));
  assert.equal(pedal.names[2], 'MTL-LEAD');
  assert.equal(backups.at(-1)!.slots[0]!.name, 'My Lead', 'the overwritten content was backed up first');
});

test('parseBackupFile accepts a written file and rejects anything else', async () => {
  const pedal = new FakePedal();
  const file = await backupAllSlots(pedal, { edited: null });
  assert.equal(parseBackupFile(JSON.stringify(file)).slots.length, 50);
  assert.throws(() => parseBackupFile('{"format":"other"}'), /not a Pocket Master backup/);
  assert.throws(() => parseBackupFile('not json'), /not a Pocket Master backup/);
  const tampered = { ...file, slots: [{ ...file.slots[0]!, payload: '1243' }] };
  assert.throws(() => parseBackupFile(JSON.stringify(tampered)), /slot P01/);
});

test('an acknowledged save whose name did not change is reported as a failure', async () => {
  const pedal = new FakePedal({ saveKeepsName: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal), sessionBackup: null }), /named "MTL-LEAD" instead of "My Lead"/);
});

test('an acknowledged save whose content differs is reported as a failure', async () => {
  const pedal = new FakePedal({ saveCorrupts: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal), sessionBackup: null }), /differs from what was edited/);
});

test('a save refuses when the pedal no longer matches the screen, before selecting anything', async () => {
  const pedal = new FakePedal();
  const screen = applyEdit(decodePreset(pedal.editBuffer), { kind: 'param', module: 3, alg: 4, value: 99 }); // never sent
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: screen, sessionBackup: null }), /differs from the screen/);
  assert.deepEqual(pedal.received, []);
});

test('a preset with a model the catalog does not know is refused before anything is sent', async () => {
  const pedal = new FakePedal();
  const unknown = 0x03ffffff;
  await pedal.sendEdits(editToCommands(decodePreset(pedal.editBuffer), { kind: 'model', module: 2, code: unknown }));
  const screen = decodePreset(pedal.editBuffer);
  pedal.received.length = 0;
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: screen, sessionBackup: null }), /DRV uses model 0x03FFFFFF/);
  assert.deepEqual(pedal.received, []);
});

test('restore refuses a damaged slot backup before loading anything', async () => {
  const pedal = new FakePedal();
  const file = await backupAllSlots(pedal, { edited: null });
  pedal.received.length = 0;
  await assert.rejects(restoreFromBackup(pedal, { ...file.slots[2]!, name: 'Way too long' }, { sessionBackup: file }), /1\.\.10/);
  assert.deepEqual(pedal.received, []);
});

test('parseBackupFile checks names, kind and creation time', async () => {
  const pedal = new FakePedal();
  const file = await backupAllSlots(pedal, { edited: null });
  assert.throws(() => parseBackupFile(JSON.stringify({ ...file, kind: 'weird' })), /not a Pocket Master backup/);
  assert.throws(() => parseBackupFile(JSON.stringify({ ...file, createdAt: 'yesterday' })), /not a Pocket Master backup/);
  assert.throws(() => parseBackupFile(JSON.stringify({ ...file, slots: [{ ...file.slots[0]!, name: 'Way too long' }] })), /slot P01/);
});
