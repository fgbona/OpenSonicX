import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matriboxLink, mbRemoveBlock, mbSetBlockOn, parseMbPreset } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { backupFromSlot, readLoaded, readUnit, saveToSlot, serialQueue, withParam, type MbBackup } from '../lib/matribox.ts';
import { keepMbBackup, mbBackupFileName } from '../lib/matriboxBackups.ts';

const unitLink = (fake = new FakeMatribox()) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 500);

test('readUnit reads the preset list, the loaded preset and the IR and capture names', async () => {
  const unit = await readUnit(unitLink());
  assert.equal(unit.names.length, 240);
  assert.equal(unit.current, 66);
  assert.equal(unit.preset.name, 'Drive AD');
  assert.equal(unit.irNames.length, 20);
  assert.equal(unit.cloneNames.length, 10);
});

test('readLoaded follows the edits of the loaded preset', async () => {
  const fake = new FakeMatribox();
  const link = unitLink(fake);
  const before = (await readLoaded(link)).preset.chain.length;
  await link.write(mbRemoveBlock(0));
  assert.equal((await readLoaded(link)).preset.chain.length, before - 1);
});

test('saveToSlot keeps a backup of the slot first, then saves and checks the slot by reading it back', async () => {
  const fake = new FakeMatribox();
  const kept: string[] = [];
  const backup = await saveToSlot(
    unitLink(fake),
    5,
    'My Tone',
    (b) => void kept.push(b.label),
    () => '2026-11-24T10:00:00.000Z',
  );
  assert.deepEqual(kept, ['2B']);
  assert.equal(backup.index, 5);
  assert.equal(parseMbPreset(fake.stored(5)!).name, 'My Tone');
});

test('saveToSlot reports a save the unit dropped, after keeping the backup', async () => {
  const fake = new FakeMatribox();
  fake.dropsSaves = true;
  const kept: string[] = [];
  await assert.rejects(
    saveToSlot(
      unitLink(fake),
      5,
      'My Tone',
      (b) => void kept.push(b.label),
      () => 'now',
      0,
    ),
    /2B does not hold "My Tone"/,
  );
  assert.deepEqual(kept, ['2B', '17C'], 'the backup of 2B, then the loaded preset with its edits');
});

// The unit answers a preset read with its edit buffer whatever slot it names (owner's unit, 2026-11-24).
test('saveToSlot to another slot backs up what that slot stores, writes the edits whole into it and leaves it loaded', async () => {
  const fake = new FakeMatribox();
  const link = unitLink(fake);
  await link.write(mbSetBlockOn(0, true));
  const edited = parseMbPreset(fake.editBuffer);
  const kept: MbBackup[] = [];
  await saveToSlot(
    link,
    5,
    'My Tone',
    (b) => void kept.push(b),
    () => 'now',
    0,
  );
  assert.deepEqual(
    kept.map((b) => [b.label, b.name, b.source]),
    [['2B', '', 'slot']],
    'the empty 2B, not the loaded "Drive AD"',
  );
  assert.equal(fake.current, 5);
  assert.equal(fake.presetWrites.length, 1);
  const stored = parseMbPreset(fake.stored(5)!);
  assert.equal(stored.chain.find((b) => b.slot === 0)?.on, edited.chain.find((b) => b.slot === 0)?.on);
});

test('saveToSlot over the loaded slot saves it with cmd 05; its backup is the edit buffer, marked so', async () => {
  const fake = new FakeMatribox();
  const kept: MbBackup[] = [];
  await saveToSlot(
    unitLink(fake),
    66,
    'Same Slot',
    (b) => void kept.push(b),
    () => 'now',
    0,
  );
  assert.deepEqual(
    kept.map((b) => [b.label, b.source]),
    [['17C', 'edit-buffer']],
  );
  assert.equal(fake.presetWrites.length, 0);
  assert.equal(parseMbPreset(fake.stored(66)!).name, 'Same Slot');
});

test('saveToSlot refuses a bad name before anything is sent', async () => {
  const fake = new FakeMatribox();
  await assert.rejects(
    saveToSlot(unitLink(fake), 5, 'é'.repeat(3), () => undefined),
    /printable ASCII/,
  );
  assert.equal(fake.received.length, 0);
});

test('withParam returns a new preset with one value changed', async () => {
  const { preset } = await readLoaded(unitLink());
  const slot = preset.chain[0]!.slot;
  const next = withParam(preset, slot, 1, 42);
  assert.equal(next.chain[0]!.values[1], 42);
  assert.notEqual(preset.chain[0]!.values[1], 42);
  assert.equal(withParam(next, slot, 1, 7).chain[0]!.on, preset.chain[0]!.on);
});

test('backups are the MCP server format and the newest 20 are kept', () => {
  const data = new FakeMatribox().stored(0x42)!;
  const backup = backupFromSlot(66, data, '2026-11-24T10:00:00.000Z');
  assert.deepEqual([backup.device, backup.label, backup.name], ['Sonicake Matribox II Pro', '17C', 'Drive AD']);
  assert.equal(parseMbPreset(Uint8Array.from(backup.preset.split(' ').map((h) => parseInt(h, 16)))).name, 'Drive AD');
  assert.equal(mbBackupFileName(backup), 'matribox-backup-17C-2026-11-24T10-00-00.json');
  const many = Array.from({ length: 25 }, (_, i) => ({ ...backup, createdAt: String(i) })).reduce(keepMbBackup, []);
  assert.equal(many.length, 20);
  assert.equal(many[0]!.createdAt, '24');
});

test('the queue runs calls one at a time and goes on after a failure', async () => {
  const run = serialQueue();
  const order: number[] = [];
  const slow = run(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push(1);
  });
  const failing = run(async () => {
    throw new Error('boom');
  });
  const fast = run(async () => void order.push(2));
  await slow;
  await assert.rejects(failing, /boom/);
  await fast;
  assert.deepEqual(order, [1, 2]);
});
