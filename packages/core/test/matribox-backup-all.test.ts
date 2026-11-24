import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHex, toHex } from '../src/hex.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { mbReadPreset, unwrapMbMessage } from '../src/matribox/message.ts';
import { MB_PRESET_COUNT, mbPresetLabel, parseMbPreset } from '../src/matribox/preset.ts';
import { mbSelectPreset } from '../src/matribox/write.ts';
import { MB_WRITE, parseMbFrame } from '../src/matribox/frame.ts';
import { mbReadSlot, mbStoreSlot } from '../src/matribox/slots.ts';
import { mbBackupAllPresets, mbRestoreAllPresets, MB_BACKUP_ALL_FORMAT, parseMbBackupAll, type MbBackupAll } from '../src/matribox/backup-all.ts';
import { FakeMatribox } from './fake-matribox.ts';

const link = (fake: FakeMatribox) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 1000);
const quiet = () => {
  const fake = new FakeMatribox();
  fake.noise = [];
  return fake;
};
const LOADED = 0x42; // 17C "Drive AD"

test('the simulated unit has the hardware bug: reading an index that is not loaded returns the edit buffer', async () => {
  const fake = quiet();
  const data = await link(fake).read(mbReadPreset(239));
  assert.equal(data[0], 239, 'tagged with the requested index');
  assert.equal(parseMbPreset(data).name, 'Drive AD', 'but it is the loaded preset');
});

test('mbReadSlot loads the slot before reading it, so it reads what the slot stores', async () => {
  const fake = quiet();
  const data = await mbReadSlot(link(fake), 239);
  assert.equal(fake.current, 239);
  assert.equal(parseMbPreset(data).name, '', 'an empty slot of the simulated unit, not the loaded "Drive AD"');
});

test('mbStoreSlot writes a whole preset into the loaded slot and checks it by reading it back', async () => {
  const fake = quiet();
  const unit = link(fake);
  const drive = parseMbPreset(fake.editBuffer);
  await unit.write(mbSelectPreset(5));
  const stored = await mbStoreSlot(unit, 5, drive);
  assert.equal(stored.name, 'Drive AD');
  assert.equal(parseMbPreset(fake.stored(5)!).name, 'Drive AD');
  await unit.write(mbSelectPreset(6));
  fake.dropsPresetWriteTo = 6;
  const edited = { ...drive, sections: drive.sections.map((s) => (s.id === 4 ? { ...s, body: Uint8Array.from(s.body, (b, i) => (i === 4 ? 0xff : b)) } : s)) };
  await assert.rejects(mbStoreSlot(unit, 6, edited), /2C differs from "Drive AD" in section 4/);
});

test('backup all reads every slot by loading it, then loads the original preset again', async () => {
  const fake = quiet();
  const unit = link(fake);
  await unit.write(mbSelectPreset(LOADED));
  const progress: number[] = [];
  const file = await mbBackupAllPresets(unit, { onProgress: (p) => progress.push(p.done), now: () => new Date('2026-11-24T12:00:00Z') });
  assert.equal(file.format, MB_BACKUP_ALL_FORMAT);
  assert.equal(file.version, 1);
  assert.equal(file.device, 'Sonicake Matribox II Pro');
  assert.equal(file.createdAt, '2026-11-24T12:00:00.000Z');
  assert.equal(file.presets.length, MB_PRESET_COUNT);
  assert.deepEqual(
    file.presets.slice(0, 2).map((p) => [p.index, p.label]),
    [
      [0, '1A'],
      [1, '1B'],
    ],
  );
  assert.equal(file.presets[LOADED]?.name, 'Drive AD');
  assert.equal(file.presets[0]?.name, '', 'slot 1A as stored, not the edit buffer');
  assert.equal(fromHex(file.presets[0]!.preset).length, 1211);
  assert.equal(fake.current, LOADED);
  assert.deepEqual(progress.slice(0, 3), [0, 1, 2]);
  assert.equal(progress.at(-1), MB_PRESET_COUNT);
});

test('restore all writes each preset whole to its index, checks it, and loads the original preset again', async () => {
  const fake = quiet();
  const unit = link(fake);
  const drive = toHex(fake.editBuffer).replaceAll(' ', '');
  const file: MbBackupAll = {
    format: MB_BACKUP_ALL_FORMAT,
    version: 1,
    device: 'Sonicake Matribox II Pro',
    createdAt: '2026-11-24T12:00:00.000Z',
    presets: [3, 4].map((index) => ({ index, label: mbPresetLabel(index), name: 'Drive AD', preset: drive })),
  };
  const { written } = await mbRestoreAllPresets(unit, parseMbBackupAll(JSON.stringify(file)));
  assert.deepEqual(written, ['1D', '2A']);
  assert.deepEqual(
    fake.presetWrites.map((w) => w[0]),
    [3, 4],
  );
  assert.equal(parseMbPreset(fake.stored(4)!).name, 'Drive AD');
  assert.equal(fake.current, LOADED);
});

test('restore all stops at the first preset the unit did not store, says what was written, and loads the original again', async () => {
  const fake = quiet();
  const unit = link(fake);
  const drive = parseMbPreset(fake.editBuffer);
  const hex = toHex(fake.editBuffer).replaceAll(' ', '');
  const changed = toHex(Uint8Array.from(fake.editBuffer, (b, i) => (i === 269 + 724 ? b ^ 1 : b))).replaceAll(' ', ''); // slot 0 on/off flipped
  assert.notEqual(parseMbPreset(fromHex(changed)).chain.find((b) => b.slot === 0)?.on, drive.chain.find((b) => b.slot === 0)?.on);
  const file = parseMbBackupAll(
    JSON.stringify({
      format: MB_BACKUP_ALL_FORMAT,
      version: 1,
      device: 'Sonicake Matribox II Pro',
      createdAt: '2026-11-24T12:00:00.000Z',
      presets: [
        { index: 0, label: '1A', name: 'Drive AD', preset: hex },
        { index: 1, label: '1B', name: 'x', preset: changed },
        { index: 2, label: '1C', name: 'Drive AD', preset: hex },
      ],
    }),
  );
  fake.dropsPresetWriteTo = 1;
  await assert.rejects(mbRestoreAllPresets(unit, file), /Restore stopped at 1B: .*section 5.*Written before it \(1 of 3\): 1A\./s);
  assert.equal(fake.presetWrites.length, 2, 'nothing after the failed one');
  assert.equal(fake.current, LOADED);
});

test('parseMbBackupAll refuses anything that is not a whole, consistent backup', () => {
  const hex = toHex(new FakeMatribox().editBuffer).replaceAll(' ', '');
  const good = { format: MB_BACKUP_ALL_FORMAT, version: 1, device: 'Sonicake Matribox II Pro', createdAt: '2026-11-24T12:00:00.000Z', presets: [{ index: 0, label: '1A', name: 'x', preset: hex }] };
  assert.equal(parseMbBackupAll(JSON.stringify(good)).presets.length, 1);
  const bad: [unknown, RegExp][] = [
    ['{', /not a Matribox backup-all file \(not JSON\)/],
    [{ ...good, format: 'pocket-master-backup' }, /not a Matribox backup-all file/],
    [{ ...good, version: 2 }, /version 2/],
    [{ ...good, device: 'Pocket Master' }, /not a Matribox backup-all file/],
    [{ ...good, presets: [] }, /1\.\.240 presets/],
    [{ ...good, presets: [{ ...good.presets[0], label: '1B' }] }, /label 1B does not match index 0/],
    [{ ...good, presets: [{ ...good.presets[0], index: 240 }] }, /index/],
    [{ ...good, presets: [good.presets[0], good.presets[0]] }, /1A appears twice/],
    [{ ...good, presets: [{ ...good.presets[0], preset: hex.slice(0, 100) }] }, /1A.*1211 bytes/],
    [{ ...good, presets: [{ ...good.presets[0], preset: 'zz' }] }, /1A/],
  ];
  for (const [file, message] of bad) assert.throws(() => parseMbBackupAll(typeof file === 'string' ? file : JSON.stringify(file)), message);
});

test('a backup sends no write but selects', async () => {
  const fake = quiet();
  await mbBackupAllPresets(link(fake), {});
  const writes = fake.received
    .map((h) => parseMbFrame(fromHex(h)))
    .filter((f) => f.type === MB_WRITE)
    .map((f) => toHex(unwrapMbMessage(f.payload).data.subarray(0, 4)));
  assert.equal(writes.length, MB_PRESET_COUNT + 1);
  assert.ok(
    writes.every((w) => w === '01 00 0A 01'),
    'only selects',
  );
});
