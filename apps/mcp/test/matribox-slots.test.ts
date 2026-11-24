// The unit answers a preset read with its edit buffer whatever index it names (owner's unit,
// 2026-11-24); the simulated unit does the same. These fail on the code that read slots unloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromHex, MB_BACKUP_ALL_FORMAT, parseMatriboxPrst, parseMbPreset, toHex } from '@pocket-master/core';
import { call, connected, text } from './matribox-helpers.ts';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const backupsOf = (folder: string, label: string) => readdirSync(folder).filter((f) => f.endsWith(`-matribox-${label}.json`)).map((f) => readJson(join(folder, f)));

test('saving to another slot backs up what that slot stores, keeps the edits and loads the slot', async () => {
  const { client, fake, backups } = await connected();
  await call(client, 'matribox_build_tone', { blocks: [{ module: 'DLY', model: 'Fake Echo' }] });
  await call(client, 'matribox_save_preset', { preset: '20A', name: 'Echo Only', confirm: '20A' });
  await call(client, 'matribox_select_preset', { preset: '17C' });
  await call(client, 'matribox_set_param', { block: 'DRV', parameter: 'Gain', value: 66 });
  const edited = parseMbPreset(fake.editBuffer);

  const out = await call(client, 'matribox_save_preset', { preset: '20A', name: 'Hot Drive', confirm: '20A' });
  assert.match(out, /^Saved the loaded preset to 20A "Hot Drive"\.$/m);
  assert.match(out, /20A is now the loaded preset/);
  assert.equal(fake.current, 76);
  const stored = parseMbPreset(fake.stored(76)!);
  assert.equal(stored.name, 'Hot Drive');
  assert.equal(stored.chain[1]?.values[0], 66, 'the unsaved edits were stored');
  assert.deepEqual(stored.chain.map((b) => b.fxid), edited.chain.map((b) => b.fxid));
  const [first, second] = backupsOf(backups, '20A').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  assert.equal(first.name, '', 'the first save backed up the empty 20A, not the loaded preset');
  assert.equal(second.name, 'Echo Only', 'what 20A stored, not the edit buffer');
  assert.equal(second.source, 'slot');
});

test('saving over the loaded slot keeps the edits: its backup is the edit buffer, and says so', async () => {
  const { client, backups } = await connected();
  const out = await call(client, 'matribox_save_preset', { preset: '17C', name: 'Same Slot', confirm: '17C' });
  assert.match(out, /Backup of 17C as loaded before the save/);
  const [backup] = backupsOf(backups, '17C');
  assert.equal(backup.source, 'edit-buffer');
});

test('a failed save to another slot keeps the loaded preset\'s edits in a backup file', async () => {
  const { client, fake, backups } = await connected();
  await call(client, 'matribox_set_param', { block: 'DRV', parameter: 'Gain', value: 66 });
  fake.dropsPresetWriteTo = 76;
  const result = await client.callTool({ name: 'matribox_save_preset', arguments: { preset: '20A', name: 'Hot Drive', confirm: '20A' } });
  assert.equal(result.isError, true);
  assert.match(text(result), /20A differs .*backup of 20A kept: .*the loaded 17C with its edits: .*-matribox-17C\.json/s);
  const [edits] = backupsOf(backups, '17C');
  assert.equal(parseMbPreset(fromHex(edits.preset)).chain[1]?.values[0], 66);
});

test('exporting a slot that is not loaded loads it to read it, then loads the original preset again', async () => {
  const { client, fake, presets } = await connected();
  await call(client, 'matribox_build_tone', { blocks: [{ module: 'DLY', model: 'Fake Echo' }] });
  await call(client, 'matribox_save_preset', { preset: '20A', name: 'Echo Only', confirm: '20A' });
  await call(client, 'matribox_select_preset', { preset: '17C' });
  const out = await call(client, 'matribox_export_preset', { preset: '20A', file: 'echo.prst' });
  assert.match(out, /^Exported 20A "Echo Only" to /m);
  assert.match(out, /unsaved edits of 17C are lost/);
  assert.equal(parseMatriboxPrst(readFileSync(join(presets, 'echo.prst'), 'utf8')).name, 'Echo Only');
  assert.equal(fake.current, 0x42);
});

test('matribox_backup_all_presets writes all 240 slots, each read once loaded, to one file in the backups folder', async () => {
  const { client, fake, backups } = await connected();
  await call(client, 'matribox_save_preset', { preset: '1A', name: 'First', confirm: '1A' });
  await call(client, 'matribox_select_preset', { preset: '17C' });
  const out = await call(client, 'matribox_backup_all_presets', { file: 'all.json' });
  assert.match(out, /^Backed up all 240 presets to .*all\.json/m);
  const file = readJson(join(backups, 'all.json'));
  assert.equal(file.format, MB_BACKUP_ALL_FORMAT);
  assert.equal(file.presets.length, 240);
  assert.equal(file.presets[0].name, 'First');
  assert.equal(file.presets[1].name, '', '1B as stored, not the loaded preset');
  assert.equal(file.presets[66].name, 'Drive AD');
  assert.equal(fake.current, 0x42);
  for (const [args, message] of [[{ file: '../x.json' }, /must be inside/], [{ file: 'x.prst' }, /\.json/], [{ file: 'all.json' }, /already exists/]] as const) {
    const result = await client.callTool({ name: 'matribox_backup_all_presets', arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(text(result), message);
  }
});

test('matribox_restore_all_presets needs confirm ALL, backs everything up first and writes each preset to its slot', async () => {
  const { client, fake, backups } = await connected();
  const drive = toHex(fake.editBuffer).replaceAll(' ', '');
  mkdirSync(backups, { recursive: true });
  const file = { format: MB_BACKUP_ALL_FORMAT, version: 1, device: 'Sonicake Matribox II Pro', createdAt: '2026-11-24T12:00:00.000Z',
    presets: [{ index: 0, label: '1A', name: 'Drive AD', preset: drive }, { index: 1, label: '1B', name: 'Drive AD', preset: drive }] };
  writeFileSync(join(backups, 'two.json'), JSON.stringify(file));
  const wrong = await client.callTool({ name: 'matribox_restore_all_presets', arguments: { file: 'two.json', confirm: '1A' } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /confirm must be "ALL"/);
  assert.equal(fake.presetWrites.length, 0);

  const out = await call(client, 'matribox_restore_all_presets', { file: 'two.json', confirm: 'all' });
  assert.match(out, /^Restored 2 presets: 1A, 1B\.$/m);
  assert.match(out, /^Backup of all 240 presets before the restore: .*-matribox-all\.json$/m);
  assert.deepEqual(fake.presetWrites.map((w) => w[0]), [0, 1]);
  assert.equal(parseMbPreset(fake.stored(1)!).name, 'Drive AD');
  assert.equal(fake.current, 0x42);

  const noBackup = await call(client, 'matribox_restore_all_presets', { file: 'two.json', confirm: 'ALL', backup: false });
  assert.doesNotMatch(noBackup, /Backup of all/);
  assert.equal(readdirSync(backups).filter((f) => f.endsWith('-matribox-all.json')).length, 1);
});

test('matribox_restore_all_presets stops at the first failure and says what was written', async () => {
  const { client, fake, backups } = await connected();
  const drive = toHex(Uint8Array.from(fake.editBuffer, (b, i) => (i === 269 + 724 ? b ^ 1 : b))).replaceAll(' ', ''); // differs from an empty slot in section 5
  mkdirSync(backups, { recursive: true });
  const presets = [0, 1, 2].map((index) => ({ index, label: ['1A', '1B', '1C'][index], name: 'Drive AD', preset: drive }));
  writeFileSync(join(backups, 'three.json'), JSON.stringify({ format: MB_BACKUP_ALL_FORMAT, version: 1, device: 'Sonicake Matribox II Pro', createdAt: '2026-11-24T12:00:00.000Z', presets }));
  writeFileSync(join(backups, 'bad.json'), JSON.stringify({ format: 'pocket-master-backup' }));
  const bad = await client.callTool({ name: 'matribox_restore_all_presets', arguments: { file: 'bad.json', confirm: 'ALL' } });
  assert.match(text(bad), /not a Matribox backup-all file/);
  assert.equal(fake.presetWrites.length, 0);

  fake.dropsPresetWriteTo = 1;
  const result = await client.callTool({ name: 'matribox_restore_all_presets', arguments: { file: 'three.json', confirm: 'ALL', backup: false } });
  assert.equal(result.isError, true);
  assert.match(text(result), /Restore stopped at 1B: .*Written before it \(1 of 3\): 1A\./s);
  assert.equal(fake.presetWrites.length, 2);
});
