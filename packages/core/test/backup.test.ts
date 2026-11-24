import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupAllSlots, saveToSlot, restoreAllFromBackup, restoreFromBackup, parseBackupFile, type BackupFile } from '../src/backup.ts';
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
  assert.deepEqual(
    file.slots.slice(0, 2).map((s) => [s.label, s.name]),
    [
      ['P01', 'MTL-CLEAN'],
      ['P02', 'MTL-RHY'],
    ],
  );
  file.slots.forEach((s) => assert.equal(slotPreset(file, s.index).volume, s.index, `slot ${s.label}`));
  assert.equal(pedal.current, 8, 'back on the original preset');
  assert.ok(same(decodePreset(pedal.editBuffer), mine), 'edits restored in the edit buffer');
});

test('backupAllSlots stops when the pedal loads a different slot than asked (loading path)', async () => {
  const pedal = new FakePedal({ wrongSelect: true, noStoredRead: true });
  await assert.rejects(backupAllSlots(pedal, { edited: null }), /asked for P01 but the pedal loaded P02/);
});

test('saveToSlot backs up the target slot first, saves, and verifies', async () => {
  const pedal = new FakePedal();
  const mine = edited(pedal);
  const before = pedal.slots[2]!.slice();
  const backups: BackupFile[] = [];
  const result = await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: mine, onBackup: (f) => backups.push(f) });
  assert.deepEqual(
    backups.map((b) => b.kind),
    ['slot'],
    'only the target slot is backed up',
  );
  assert.deepEqual(fromHex(backups[0]!.slots[0]!.payload), before, 'target backup is the old slot content');
  assert.equal(backups[0]!.slots[0]!.name, 'MTL-LEAD');
  assert.ok(same(decodePreset(pedal.slots[2]!), mine), 'slot holds the edited preset');
  assert.equal(pedal.names[2], 'My Lead');
  assert.ok(same(result.saved, mine));
  assert.equal(result.targetBackup?.kind, 'slot');
});

test('saveToSlot does not sweep the other slots (a pedal without the stored-preset read)', async () => {
  const pedal = new FakePedal({ noStoredRead: true });
  await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal) });
  const selected = pedal.received.filter((r) => r.startsWith('select')).map((r) => Number(r.split(' ')[1]));
  assert.deepEqual(selected, [2, 8, 2], 'target backup, back to the loaded preset, verify');
});

test('a failed acknowledge is reported and never counted as saved', async () => {
  const pedal = new FakePedal({ nack: true });
  const before = pedal.slots[2]!.slice();
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: edited(pedal) }), /reported that the save failed/);
  assert.deepEqual(pedal.slots[2], before);
});

test('a missing acknowledge fails the save', async () => {
  const pedal = new FakePedal({ noAck: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: edited(pedal) }), /no acknowledge/);
});

test('a factory target or a bad name is refused before anything is sent', async () => {
  for (const [target, name] of [
    [50, 'x'],
    [2, 'Way too long'],
    [2, ''],
  ] as const) {
    const pedal = new FakePedal();
    await assert.rejects(saveToSlot(pedal, { target, name, edited: null }));
    assert.deepEqual(pedal.received, [], `nothing sent for ${target} "${name}"`);
  }
});

test('a backup failure stops the save before it is written (loading path)', async () => {
  const pedal = new FakePedal({ wrongSelect: true, noStoredRead: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: null }));
  assert.ok(!pedal.received.some((r) => r.startsWith('save')));
});

test('restoreFromBackup writes a backed-up slot back, without another backup first', async () => {
  const pedal = new FakePedal();
  const backups: BackupFile[] = [];
  await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal), onBackup: (f) => backups.push(f) });
  const original = backups[0]!; // slot backup of P03 before the save
  await restoreFromBackup(pedal, original.slots[0]!, { onBackup: (f) => backups.push(f), pause: async () => {} });
  assert.ok(same(decodePreset(pedal.slots[2]!), slotPreset(original, 2)));
  assert.equal(pedal.names[2], 'MTL-LEAD');
  assert.equal(backups.length, 1, 'the restore takes no backup of its own (owner, 2026-11-22)');
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
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal), pause: async () => {} }), /named "MTL-LEAD" instead of "My Lead"/);
});

test('an acknowledged save whose content differs is reported as a failure', async () => {
  const pedal = new FakePedal({ saveCorrupts: true });
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal) }), /differs from what was edited/);
});

test('a save refuses when the pedal no longer matches the screen, before selecting anything', async () => {
  const pedal = new FakePedal();
  const screen = applyEdit(decodePreset(pedal.editBuffer), { kind: 'param', module: 3, alg: 4, value: 99 }); // never sent
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: screen }), /differs from the screen/);
  assert.deepEqual(pedal.received, []);
});

test('a preset with a model the catalog does not know is refused before anything is sent', async () => {
  const pedal = new FakePedal();
  const unknown = 0x03ffffff;
  await pedal.sendEdits(editToCommands(decodePreset(pedal.editBuffer), { kind: 'model', module: 2, code: unknown }));
  const screen = decodePreset(pedal.editBuffer);
  pedal.received.length = 0;
  await assert.rejects(saveToSlot(pedal, { target: 2, name: 'x', edited: screen }), /DRV uses model 0x03FFFFFF/);
  assert.deepEqual(pedal.received, []);
});

test('restore refuses a damaged slot backup before loading anything', async () => {
  const pedal = new FakePedal();
  const file = await backupAllSlots(pedal, { edited: null });
  pedal.received.length = 0;
  await assert.rejects(restoreFromBackup(pedal, { ...file.slots[2]!, name: 'Way too long' }, {}), /1\.\.10/);
  assert.deepEqual(pedal.received, []);
});

test('parseBackupFile checks names, kind and creation time', async () => {
  const pedal = new FakePedal();
  const file = await backupAllSlots(pedal, { edited: null });
  assert.throws(() => parseBackupFile(JSON.stringify({ ...file, kind: 'weird' })), /not a Pocket Master backup/);
  assert.throws(() => parseBackupFile(JSON.stringify({ ...file, createdAt: 'yesterday' })), /not a Pocket Master backup/);
  assert.throws(() => parseBackupFile(JSON.stringify({ ...file, slots: [{ ...file.slots[0]!, name: 'Way too long' }] })), /slot P01/);
});

test('saveToSlot with backup off saves directly: no backup, no extra selection', async () => {
  const pedal = new FakePedal();
  const mine = edited(pedal);
  const backups: BackupFile[] = [];
  const result = await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: mine, backup: false, onBackup: (f) => backups.push(f) });
  assert.deepEqual(backups, []);
  assert.equal(result.targetBackup, null);
  const selected = pedal.received.filter((r) => r.startsWith('select')).map((r) => Number(r.split(' ')[1]));
  assert.deepEqual(selected, [2], 'only the verify step loads the slot');
  assert.ok(same(decodePreset(pedal.slots[2]!), mine));
});

test('saveToSlot waits for the backup to be stored and does not save when storing it fails', async () => {
  const pedal = new FakePedal();
  const old = pedal.slots[2]!.slice();
  let stored = false;
  await saveToSlot(pedal, {
    target: 2,
    name: 'OK',
    edited: null,
    onBackup: async () => {
      await new Promise((r) => setImmediate(r));
      stored = true;
    },
  });
  assert.equal(stored, true);
  const failing = new FakePedal();
  await assert.rejects(
    saveToSlot(failing, {
      target: 2,
      name: 'NOPE',
      edited: null,
      onBackup: async () => {
        throw new Error('disk full');
      },
    }),
    /disk full/,
  );
  assert.equal(
    failing.received.some((r) => r.startsWith('save')),
    false,
    'nothing saved without a stored backup',
  );
  assert.deepEqual(failing.slots[2], old);
});

test('a name read that still answers the old name right after the save is read again', async () => {
  const pedal = new FakePedal({ staleNameReads: 2 });
  const result = await saveToSlot(pedal, { target: 2, name: 'QClean', edited: edited(pedal), backup: false, pause: async () => {} });
  assert.equal(pedal.names[2], 'QClean');
  assert.ok(result.saved);
});

test('with the stored-preset read, backups never load a slot: no selection, edits untouched', async () => {
  const pedal = new FakePedal();
  const mine = edited(pedal);
  const file = await backupAllSlots(pedal, { edited: mine });
  assert.equal(file.slots.length, 50);
  file.slots.forEach((s) => assert.equal(slotPreset(file, s.index).volume, s.index, `slot ${s.label}`));
  await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: mine, pause: async () => {} });
  const selected = pedal.received.filter((r) => r.startsWith('select')).map((r) => Number(r.split(' ')[1]));
  assert.deepEqual(selected, [2], 'only the check after the save loads a slot');
});

test('restoreFromBackup also works on a pedal without the stored-preset read (loading path)', async () => {
  const pedal = new FakePedal({ noStoredRead: true });
  const backups: BackupFile[] = [];
  await saveToSlot(pedal, { target: 2, name: 'My Lead', edited: edited(pedal), onBackup: (f) => backups.push(f) });
  await restoreFromBackup(pedal, backups[0]!.slots[0]!, { onBackup: (f) => backups.push(f) });
  assert.ok(same(decodePreset(pedal.slots[2]!), slotPreset(backups[0]!, 2)));
  assert.equal(pedal.names[2], 'MTL-LEAD');
});

test('restoreAllFromBackup puts every slot back, with no backup first, and returns to the loaded preset', async () => {
  const pedal = new FakePedal();
  const before = await backupAllSlots(pedal, { edited: null });
  const originals = pedal.slots.slice(0, 50).map((s) => Array.from(s));
  await saveToSlot(pedal, { target: 2, name: 'Changed', edited: edited(pedal), pause: async () => {} });
  await saveToSlot(pedal, { target: 40, name: 'Also', edited: decodePreset(pedal.editBuffer), pause: async () => {} });
  await pedal.selectPreset(8);
  const kept: BackupFile[] = [];
  const progress: number[] = [];
  const stored = () => pedal.received.filter((r) => r.startsWith('stored')).length;
  const readsBefore = stored();
  const result = await restoreAllFromBackup(pedal, before, { onBackup: (f) => kept.push(f), pause: async () => {}, onProgress: (p) => progress.push(p.done / p.total) });
  assert.ok(
    progress.every((v, i) => i === 0 || v >= progress[i - 1]!),
    'one bar that never goes back',
  );
  assert.equal(progress.at(-1), 1);
  assert.equal(result.restored, 50);
  pedal.slots.slice(0, 50).forEach((s, i) => assert.ok(same(decodePreset(s), decodePreset(Uint8Array.from(originals[i]!))), `P${i + 1}`));
  assert.equal(pedal.names[2], 'MTL-LEAD');
  assert.equal(kept.length, 0, 'no backup of its own');
  assert.equal(stored(), readsBefore, 'the slots are not read first');
  assert.equal(pedal.current, 8, 'back on the preset that was loaded');
});
