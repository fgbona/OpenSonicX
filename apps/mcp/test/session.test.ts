import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePreset, modelsFor, parseBackupFile } from '@pocket-master/core';
import { FakePedal } from '../../../packages/core/test/fake-pedal.ts';
import { Session, type PedalIO } from '../src/session.ts';

const SLOT_NAMES = { irNames: ['Mesa OS', null, null, null, null], profileNames: ['Randall SA', null, null, null, null] };

function setup(start = 8, options: ConstructorParameters<typeof FakePedal>[0] = {}) {
  const fake = new FakePedal(options, start);
  const io: PedalIO = Object.assign(fake, { readSlotNames: async () => SLOT_NAMES, readModified: async () => false });
  let opened = 0;
  let closed = 0;
  let maxOpenAtOnce = 0;
  const dir = mkdtempSync(join(tmpdir(), 'pm-mcp-'));
  const connect = async () => {
    opened++;
    maxOpenAtOnce = Math.max(maxOpenAtOnce, opened - closed);
    await new Promise((r) => setImmediate(r)); // let a concurrent call try to get in
    return { io, close: () => void closed++ };
  };
  const session = new Session(connect, { backups: join(dir, 'backups'), presets: join(dir, 'presets') });
  const block = (key: string) => decodePreset(fake.editBuffer).chain.find((b) => b.key === key)!;
  return { fake, session, dir, block, counts: () => ({ opened, closed, maxOpenAtOnce }) };
}

test('describe names the preset and lists every block with its model and values', async () => {
  const { session, fake, counts } = setup();
  const text = await session.describe();
  assert.match(text, new RegExp(`^P09 "${fake.names[8]}"`));
  assert.match(text, /\nAMP +(on|off) +\S.*: Gain /);
  assert.match(text, /Chain: NR → /);
  assert.deepEqual(counts(), { opened: 1, closed: 1, maxOpenAtOnce: 1 }, 'one connection per call, always closed');
});

test('edit changes a parameter by name and reports the preset as the pedal now holds it', async () => {
  const { session, block } = setup();
  const text = await session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }]);
  assert.equal(block('amp').params.find((p) => p.name === 'Gain')!.value, 70);
  assert.match(text, /Gain 70/);
});

test('edit checks every change before sending any of them', async () => {
  const { session, fake } = setup();
  const before = fake.received.length;
  await assert.rejects(
    session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }, { kind: 'parameter', block: 'amp', parameter: 'gain', value: 500 }]),
    /Gain must be 0\.\.100/,
  );
  assert.equal(fake.received.length, before, 'nothing was sent');
});

test('edit applies changes in order, so a parameter can follow the model it belongs to', async () => {
  const { session, block } = setup();
  await session.edit([{ kind: 'model', block: 'drv', model: 'Grey Fuzz' }, { kind: 'block', block: 'drv', on: true }]);
  assert.equal(block('drv').model, 'Grey Fuzz');
  assert.equal(block('drv').on, true);
});

test('choosing a captured profile by name switches clone mode and turns IR off', async () => {
  const { session, fake } = setup();
  await session.edit([{ kind: 'model', block: 'AMP', model: 'Randall SA' }]);
  const preset = decodePreset(fake.editBuffer);
  assert.equal(preset.ampMode, 'clone');
  assert.equal(preset.chain.find((b) => b.key === 'ir')!.on, false);
});

test('move puts a block at a 1-based position in the chain', async () => {
  const { session, fake } = setup();
  await session.edit([{ kind: 'move', block: 'dly', position: 1 }]);
  assert.equal(decodePreset(fake.editBuffer).chain[0]!.key, 'dly');
});

test('select loads a preset by label; revert reloads the saved slot', async () => {
  const { session, fake, block } = setup();
  await session.select('P03');
  assert.equal(fake.current, 2);
  await session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 1 }]);
  await session.revert();
  assert.deepEqual(fake.editBuffer, fake.slots[2]);
  assert.notEqual(block('amp').params.find((p) => p.name === 'Gain')!.value, 1);
});

test('save refuses without a confirmation that names the slot, and sends nothing', async () => {
  const { session, fake } = setup();
  await assert.rejects(session.save({ slot: 'P03', name: 'CRUNCH', confirm: 'yes' }), /confirm must be "P03"/);
  assert.equal(fake.received.some((r) => r.startsWith('save')), false);
});

test('save backs the target slot up to a file first, then saves and checks it', async () => {
  const { session, fake, dir } = setup();
  const old = fake.slots[2]!.slice();
  const text = await session.save({ slot: 'P03', name: 'CRUNCH', confirm: 'P03' });
  assert.equal(fake.names[2], 'CRUNCH');
  const files = readdirSync(join(dir, 'backups'));
  assert.equal(files.length, 1);
  const backup = parseBackupFile(readFileSync(join(dir, 'backups', files[0]!), 'utf8'));
  assert.equal(backup.slots[0]!.label, 'P03');
  assert.equal(backup.slots[0]!.payload, Buffer.from(old).toString('hex').toUpperCase());
  assert.match(text, /Saved P03 "CRUNCH"/);
  assert.match(text, /Backup of the old P03: /);
});

test('save with backup false writes no file', async () => {
  const { session, dir } = setup();
  await session.save({ slot: 'P03', name: 'CRUNCH', confirm: 'P03', backup: false });
  assert.throws(() => readdirSync(join(dir, 'backups')));
});

test('restore writes a backed-up slot back, after backing up what it overwrites', async () => {
  const { session, fake, dir } = setup();
  const old = fake.slots[2]!.slice();
  await session.save({ slot: 'P03', name: 'CRUNCH', confirm: 'P03' });
  const file = join(dir, 'backups', readdirSync(join(dir, 'backups'))[0]!);
  await assert.rejects(session.restore({ file, confirm: 'P04' }), /confirm must be "P03"/);
  await session.restore({ file, confirm: 'P03' });
  assert.deepEqual(fake.slots[2], old);
  assert.equal(readdirSync(join(dir, 'backups')).length, 2);
});

test('export writes the edit buffer to a preset file and never overwrites one', async () => {
  const { session, dir } = setup();
  await session.exportPreset('mine.json');
  assert.equal(JSON.parse(readFileSync(join(dir, 'presets', 'mine.json'), 'utf8')).format, 'pocket-master-preset');
  await assert.rejects(session.exportPreset('mine.json'), /already exists/);
});

test('import loads a preset file into the edit buffer without saving it', async () => {
  const { session, fake, dir } = setup();
  const file = 'p08.json';
  await session.exportPreset(file);
  await session.select('P03');
  await session.importPreset(file);
  assert.equal(fake.current, 2, 'still on P03, nothing selected');
  assert.equal(fake.received.some((r) => r.startsWith('save')), false);
  assert.deepEqual(decodePreset(fake.editBuffer), decodePreset(fake.slots[8]!));
});

test('import refuses a file that is not a preset', async () => {
  const { session, dir } = setup();
  await session.exportPreset('seed.json'); // creates the presets folder
  writeFileSync(join(dir, 'presets', 'x.json'), '{"hello":1}');
  await assert.rejects(session.importPreset('x.json'), /not a Pocket Master preset file/);
});

test('listModels shows user IRs and captured profiles by their loaded names', async () => {
  const { session } = setup();
  assert.match(await session.listModels('ir'), /Mesa OS \(User IR 1\)/);
  const amp = await session.listModels('amp');
  assert.match(amp, /Randall SA \(profile 1\)/);
  assert.match(amp, new RegExp(modelsFor('amp')[0]!.name));
});

test('calls run one at a time, so two edits never interleave on the pedal', async () => {
  const { session, counts } = setup();
  await Promise.all([session.describe(), session.edit([{ kind: 'volume', value: 50 }]), session.describe()]);
  assert.deepEqual(counts(), { opened: 3, closed: 3, maxOpenAtOnce: 1 });
});

test('a failed call still closes its connection and does not block the next one', async () => {
  const { session, counts } = setup();
  await assert.rejects(session.edit([{ kind: 'block', block: 'nope', on: true }]), /No block "nope"/);
  await session.describe();
  assert.deepEqual(counts(), { opened: 2, closed: 2, maxOpenAtOnce: 1 });
});

test('a save the pedal refuses still keeps the backup file, and the error says where', async () => {
  const { session, dir } = setup(8, { nack: true });
  await assert.rejects(session.save({ slot: 'P03', name: 'CRUNCH', confirm: 'P03' }), /save failed.*backup kept: .*P03\.json/);
  assert.equal(readdirSync(join(dir, 'backups')).length, 1);
});

test('a backup that cannot be written stops the save before the slot is touched', async () => {
  const { session, fake, dir } = setup();
  writeFileSync(join(dir, 'backups'), 'not a folder');
  const old = fake.slots[2]!.slice();
  await assert.rejects(session.save({ slot: 'P03', name: 'CRUNCH', confirm: 'P03' }));
  assert.equal(fake.received.some((r) => r.startsWith('save')), false);
  assert.deepEqual(fake.slots[2], old);
});

test('a value of the wrong type for the parameter is refused, not coerced', async () => {
  const { session, fake } = setup();
  await session.edit([{ kind: 'model', block: 'fx2', model: 'Boost' }]);
  const before = fake.received.length;
  await assert.rejects(session.edit([{ kind: 'parameter', block: 'fx2', parameter: '+3dB', value: 'yes' }]), /\+3dB is a switch/);
  await assert.rejects(session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: '' }]), /Gain needs a number/);
  await assert.rejects(session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: true }]), /Gain needs a number/);
  assert.equal(fake.received.length, before);
  await session.edit([{ kind: 'parameter', block: 'fx2', parameter: '+3dB', value: 'OFF' }]);
});

test('files stay inside the editor folders', async () => {
  const { session, dir } = setup();
  await assert.rejects(session.exportPreset('../escape.json'), /inside .*presets/);
  await assert.rejects(session.exportPreset(join(dir, 'abs.json')), /inside .*presets/);
  await assert.rejects(session.importPreset('/etc/hosts'), /inside .*presets/);
  await assert.rejects(session.restore({ file: '/etc/hosts', confirm: 'P03' }), /inside .*backups/);
  await session.exportPreset('sub/ok.json');
});

test('names changed on the pedal show up on the next call', async () => {
  const { session, fake } = setup();
  await session.describe();
  fake.names[8] = 'RENAMED';
  assert.match(await session.describe(), /^P09 "RENAMED"/);
});
