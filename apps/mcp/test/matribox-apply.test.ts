import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fromHex, MB_WRITE, parseMatriboxPrst, parseMbFrame, parseMbPreset, type MbPreset } from '@pocket-master/core';
import { call, CATALOG, connected, text } from './matribox-helpers.ts';

const UNCHECKED = /Experimental: .*not yet checked on the owner's unit/;
const WHOLE = /in one write: chain, parameters, knob, expression-pedal and footswitch assignments, volume and tempo/;
/** Chain edits and per-parameter writes (flag 1) the simulated unit received: a whole-preset import sends none. */
const liveWrites = (fake: { received: string[] }) =>
  fake.received.map((hex) => parseMbFrame(fromHex(hex))).filter((f) => f.type === MB_WRITE && f.offset === 0 && f.payload.length === f.total && f.payload[0] === 1).length;
const writes = (fake: { received: string[] }) => fake.received.filter((hex) => parseMbFrame(fromHex(hex)).type === MB_WRITE).length;

/** Chain as (module, fxid, on) in signal order, and each block's values the catalog names (all 15 when unknown). */
function sound(preset: MbPreset) {
  return preset.chain.map((b) => {
    const model = CATALOG.modules.find((m) => m.index === b.moduleIndex)?.models.find((m) => m.fxid === b.fxid);
    const ids = model ? model.params.map((p) => p.id) : b.values.map((_, id) => id);
    return [b.moduleIndex, b.fxid, b.on, ids.map((id) => b.values[id])];
  });
}

test('the preset file tools are listed; import and restore are destructive, and all say they are unchecked', async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  for (const name of ['matribox_export_preset', 'matribox_import_preset', 'matribox_restore_backup']) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, false, name);
    assert.equal(tool?.annotations?.destructiveHint, name !== 'matribox_export_preset', name);
    assert.match(tool?.description ?? '', /experimental/i, name);
  }
  for (const name of ['matribox_import_preset', 'matribox_restore_backup']) {
    assert.match(tools.find((t) => t.name === name)?.description ?? '', /one write.*assignments, volume and tempo/, name);
  }
});

test('matribox_export_preset writes the loaded preset, or a slot, as a .prst in the Matribox presets folder', async () => {
  const { client, fake, presets } = await connected();
  await call(client, 'matribox_set_param', { block: 'DRV', parameter: 'Gain', value: 77 });
  const out = await call(client, 'matribox_export_preset', {});
  const [file] = readdirSync(presets);
  assert.ok(file?.endsWith('.prst'), String(file));
  assert.match(out, /^Exported 17C "Drive AD" to .*\.prst$/m);
  const exported = parseMatriboxPrst(readFileSync(join(presets, file as string), 'utf8'));
  assert.deepEqual(sound(exported), sound(parseMbPreset(fake.editBuffer)));
  assert.equal(exported.chain[1]?.values[0], 77);

  const named = await call(client, 'matribox_export_preset', { preset: '20a', file: 'blank.prst' });
  assert.match(named, /^Exported 20A "" to .*blank\.prst$/m); // what 20A stores, not the loaded preset
  assert.equal(writes(fake), 3, 'the parameter, then 20A selected to read it and 17C again');
});

test('matribox_export_preset refuses paths outside its folder, other extensions and existing files', async () => {
  const { client } = await connected();
  await call(client, 'matribox_export_preset', { file: 'a.prst' });
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ file: '../escape.prst' }, /must be inside/],
    [{ file: '/tmp/abs.prst' }, /must be inside/],
    [{ file: 'tone.json' }, /\.prst/],
    [{ file: 'a.prst' }, /already exists/],
  ];
  for (const [args, message] of cases) {
    const result = await client.callTool({ name: 'matribox_export_preset', arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(text(result), message);
  }
});

test('matribox_import_preset stores a .prst whole in the confirmed slot with one write, after a backup of that slot', async () => {
  const { client, fake, backups } = await connected();
  await call(client, 'matribox_export_preset', { file: 'drive.prst' });
  const file = parseMbPreset(fake.editBuffer);
  await call(client, 'matribox_build_tone', { blocks: [{ module: 'DLY', model: 'Fake Echo', params: { Time: 900 } }] });
  await call(client, 'matribox_save_preset', { preset: '20A', name: 'Echo Only', confirm: '20A' });
  const before = liveWrites(fake);
  const out = await call(client, 'matribox_import_preset', { file: 'drive.prst', preset: '20a', confirm: '20A' });
  assert.match(out, /^Stored "Drive AD" in 20A in one write/m);
  assert.match(out, WHOLE);
  assert.match(out, /^Chain: DYN → DRV → AMP → CAB → RVB → VOL$/m);
  assert.match(out, UNCHECKED);
  assert.equal(liveWrites(fake) - before, 1, 'only the select of 20A: no chain edit, parameter write or save');
  assert.equal(fake.presetWrites.length, 2, 'the save of the echo tone to 20A, then the import');
  assert.deepEqual([...(fake.presetWrites[1] as Uint8Array).subarray(0, 8)], [76, 0, 0, 0, 0x02, 0, 0, 0x10]); // 20A, .prst tag
  assert.equal(fake.current, 76, '20A is loaded, as the official app does');
  assert.deepEqual(sound(parseMbPreset(fake.stored(76) as Uint8Array)), sound(file));
  assert.equal(parseMbPreset(fake.stored(76) as Uint8Array).name, 'Drive AD');
  // What 20A stored before (the echo tone) was backed up first.
  const backup = readdirSync(backups)
    .filter((f) => f.endsWith('-matribox-20A.json'))
    .map((f) => JSON.parse(readFileSync(join(backups, f), 'utf8')))
    .find((b) => b.name === 'Echo Only');
  assert.ok(backup && out.includes('-matribox-20A'), 'backup of 20A');
});

test('matribox_import_preset needs the slot and confirm with its label, sending nothing otherwise', async () => {
  const { client, fake } = await connected();
  await call(client, 'matribox_export_preset', { file: 'drive.prst' });
  const before = writes(fake);
  const noSlot = await client.callTool({ name: 'matribox_import_preset', arguments: { file: 'drive.prst' } });
  assert.equal(noSlot.isError, true);
  const wrong = await client.callTool({ name: 'matribox_import_preset', arguments: { file: 'drive.prst', preset: '20A', confirm: '20B' } });
  assert.match(text(wrong), /confirm must be "20A"/);
  assert.equal(writes(fake), before);
});

test('a whole-preset write the unit does not acknowledge fails, keeping the backup', async () => {
  const { client, fake } = await connected();
  await call(client, 'matribox_export_preset', { file: 'drive.prst' });
  fake.acksPresetWrites = false;
  const result = await client.callTool({ name: 'matribox_import_preset', arguments: { file: 'drive.prst', preset: '17C', confirm: '17C' } });
  assert.equal(result.isError, true);
  assert.match(text(result), /did not (acknowledge the preset write|confirm the write).*backup of 17C kept: .*-matribox-17C\.json/s);
});

test('matribox_import_preset with a new name stores it, then names the slot with a save', async () => {
  const { client, fake } = await connected();
  await call(client, 'matribox_export_preset', { file: 'drive.prst' });
  const out = await call(client, 'matribox_import_preset', { file: 'drive.prst', preset: '20A', name: 'Imported', confirm: '20a' });
  assert.match(out, /^Stored "Drive AD" in 20A in one write/m);
  assert.match(out, /^Saved the loaded preset to 20A "Imported"\.$/m);
  assert.equal(parseMbPreset(fake.stored(76) as Uint8Array).name, 'Imported');
});

test('matribox_import_preset refuses files outside its folder, missing files and files that are not presets, sending nothing', async () => {
  const { client, fake, presets } = await connected();
  await call(client, 'matribox_export_preset', { file: 'x.prst' });
  writeFileSync(join(presets, 'junk.prst'), 'not a preset');
  const cases: [string, RegExp][] = [
    ['../../b/x.prst', /must be inside/],
    ['missing.prst', /ENOENT|no such file/i],
    ['junk.prst', /\.prst/],
    ['x.json', /\.prst/],
  ];
  for (const [file, message] of cases) {
    const result = await client.callTool({ name: 'matribox_import_preset', arguments: { file, preset: '20A', confirm: '20A' } });
    assert.equal(result.isError, true, file);
    assert.match(text(result), message);
  }
  assert.equal(writes(fake), 0);
});

test('matribox_restore_backup stores a save_preset backup back in its own slot with one write', async () => {
  const { client, fake, backups } = await connected();
  const original = parseMbPreset(fake.editBuffer);
  await call(client, 'matribox_save_preset', { preset: '20A', name: 'Drive AD', confirm: '20A' });
  await call(client, 'matribox_select_preset', { preset: '17C' });
  await call(client, 'matribox_build_tone', { blocks: [{ module: 'AMP', model: 'Fake Plexi' }] });
  await call(client, 'matribox_save_preset', { preset: '20A', name: 'Overwrote', confirm: '20A' });
  // The second save's backup holds what 20A stored before it: Drive AD.
  const file = readdirSync(backups).find((f) => JSON.parse(readFileSync(join(backups, f), 'utf8')).name === 'Drive AD');
  assert.ok(file);

  const wrong = await client.callTool({ name: 'matribox_restore_backup', arguments: { file, confirm: '17C' } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /confirm must be "20A"/);
  const outside = await client.callTool({ name: 'matribox_restore_backup', arguments: { file: '../p/matribox/x.json', confirm: '20A' } });
  assert.match(text(outside), /must be inside/);

  const out = await call(client, 'matribox_restore_backup', { file, confirm: '20A' });
  assert.match(out, /^Stored "Drive AD" in 20A in one write/m);
  assert.match(out, WHOLE);
  assert.match(out, UNCHECKED);
  const stored = parseMbPreset(fake.stored(76) as Uint8Array);
  assert.equal(stored.name, 'Drive AD');
  assert.deepEqual(sound(stored), sound(original));
  assert.equal(readdirSync(backups).length, 3, 'the overwritten slot is backed up again');
});

test('matribox_restore_backup refuses a file that is not a Matribox backup', async () => {
  const { client, backups } = await connected();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(backups, { recursive: true });
  writeFileSync(join(backups, 'pm.json'), JSON.stringify({ slot: 'P01' }));
  writeFileSync(join(backups, 'bad-label.json'), JSON.stringify({ device: 'Sonicake Matribox II Pro', label: '1A', index: 5, name: 'x', preset: '00' }));
  for (const [file, message] of [
    ['pm.json', /not a Matribox backup/],
    ['bad-label.json', /label/],
  ] as const) {
    const result = await client.callTool({ name: 'matribox_restore_backup', arguments: { file: basename(file), confirm: '1A' } });
    assert.equal(result.isError, true, file);
    assert.match(text(result), message);
  }
});

test("export, import and save work without the official app's catalog (blocks shown by module number)", async () => {
  const { client, fake } = await connected({ catalog: () => Promise.reject(new Error('no catalog installed')) });
  await call(client, 'matribox_export_preset', { file: 'drive.prst' });
  const out = await call(client, 'matribox_import_preset', { file: 'drive.prst', preset: '20A', confirm: '20A' });
  assert.match(out, /^Chain: module 0 → module 3 → module 4 → module 5 → module 10 → module 15$/m);
  assert.match(out, /^Stored "Drive AD" in 20A in one write/m);
  assert.equal(parseMbPreset(fake.stored(76) as Uint8Array).name, 'Drive AD');
});
