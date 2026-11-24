import { setGlobal } from '@pocket-master/core';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePreset, modelsFor, parseBackupFile } from '@pocket-master/core';
import { FakePedal } from '../../../packages/core/test/fake-pedal.ts';
import { Session, type PedalIO } from '../src/session.ts';

const SLOT_NAMES = { irNames: ['Mesa OS', null, null, null, null], profileNames: ['Randall SA', null, null, null, null] };

const GLOBALS = { masterVolume: 80, inputLevel: -3, fxRecLevel: 2, monitorLevel: 0, btRecLevel: 0, backlight: 6, mode: 1, bootProtection: 1, reamp: 0, eco: 0, expFsType: 1 } as const;

function setup(start = 8, options: ConstructorParameters<typeof FakePedal>[0] = {}) {
  const fake = new FakePedal(options, start);
  const irNames = [...SLOT_NAMES.irNames];
  const profileNames = [...SLOT_NAMES.profileNames];
  const uploads: { slot: number; name: string; bytes: number }[] = [];
  const globalWrites: Uint8Array[] = [];
  const io: PedalIO = Object.assign(fake, {
    readSlotNames: async () => ({ irNames: [...irNames], profileNames: [...profileNames] }),
    readModified: async () => false,
    uploadIr: async (slot: number, name: string, wav: Uint8Array) => {
      uploads.push({ slot, name, bytes: wav.length });
      irNames[slot] = name;
    },
    uploadProfile: async (slot: number, name: string) => {
      uploads.push({ slot, name, bytes: -1 });
      profileNames[slot] = name;
    },
    renameSlot: async (kind: 'ir' | 'profile', slot: number, name: string) => {
      (kind === 'ir' ? irNames : profileNames)[slot] = name;
      uploads.push({ slot, name, bytes: -2 });
    },
    readGlobals: async () => GLOBALS,
    writeGlobals: async (bytes: Uint8Array[]) => void globalWrites.push(...bytes),
    copyPreset: async (destination: number, source: number) => {
      fake.slots[destination] = fake.slots[source]!.slice();
      fake.names[destination] = fake.names[source]!;
      fake.received.push(`copy ${source} ${destination}`);
    },
    setTuner: async (on: boolean) => void fake.received.push(`tuner ${on ? 'on' : 'off'}`),
    clearSlot: async (kind: 'ir' | 'profile', slot: number) => {
      (kind === 'ir' ? irNames : profileNames)[slot] = null;
      fake.received.push(`clear ${kind} ${slot}`);
    },
  });
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
  const session = new Session(connect, { backups: join(dir, 'backups'), presets: join(dir, 'presets'), irs: join(dir, 'irs'), nams: join(dir, 'nams') });
  const block = (key: string) => decodePreset(fake.editBuffer).chain.find((b) => b.key === key)!;
  return { fake, session, dir, block, uploads, globalWrites, counts: () => ({ opened, closed, maxOpenAtOnce }) };
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
    session.edit([
      { kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 },
      { kind: 'parameter', block: 'amp', parameter: 'gain', value: 500 },
    ]),
    /Gain must be 0\.\.100/,
  );
  assert.equal(fake.received.length, before, 'nothing was sent');
});

test('edit applies changes in order, so a parameter can follow the model it belongs to', async () => {
  const { session, block } = setup();
  await session.edit([
    { kind: 'model', block: 'drv', model: 'Grey Fuzz' },
    { kind: 'block', block: 'drv', on: true },
  ]);
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
  assert.equal(
    fake.received.some((r) => r.startsWith('save')),
    false,
  );
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

test('copy backs the destination up, then copies the stored preset over it; the loaded preset stays', async () => {
  const { session, fake, dir } = setup();
  const old = fake.slots[44]!.slice();
  await assert.rejects(session.copy({ source: 'P02', destination: 'P45', confirm: 'P02' }), /confirm must be "P45"/);
  assert.equal(
    fake.received.some((r) => r.startsWith('copy')),
    false,
  );
  const text = await session.copy({ source: 'P02', destination: 'P45', confirm: 'P45' });
  assert.deepEqual(fake.slots[44], fake.slots[1]);
  assert.equal(fake.names[44], fake.names[1]);
  const backup = parseBackupFile(readFileSync(join(dir, 'backups', readdirSync(join(dir, 'backups'))[0]!), 'utf8'));
  assert.equal(backup.slots[0]!.label, 'P45');
  assert.equal(backup.slots[0]!.payload, Buffer.from(old).toString('hex').toUpperCase());
  assert.match(text, /Copied P02 .* to P45/);
  assert.match(text, /Backup of the old P45: /);
  assert.match(text, /^P09 /m); // still the loaded preset
});

test('copy refuses a factory destination and copying a slot onto itself', async () => {
  const { session } = setup();
  await assert.rejects(session.copy({ source: 'P02', destination: 'F01', confirm: 'F01' }), /P01\.\.P50/);
  await assert.rejects(session.copy({ source: 'P02', destination: 'P02', confirm: 'P02' }), /itself/);
});

test('the tuner turns on and off, and the reply says the pedal does not report it', async () => {
  const { session, fake } = setup();
  assert.match(await session.tuner({ on: true }), /Tuner on/);
  await session.tuner({ on: false });
  assert.deepEqual(
    fake.received.filter((r) => r.startsWith('tuner')),
    ['tuner on', 'tuner off'],
  );
});

test('delete_slot empties an IR or profile slot only when confirm repeats its label, like load_ir and load_nam', async () => {
  const { session, fake } = setup();
  await assert.rejects(session.deleteSlot({ kind: 'ir', slot: 1, confirm: 'Mesa OS' }), /confirm must be "IR1"/);
  await assert.rejects(session.deleteSlot({ kind: 'profile', slot: 1, confirm: 'IR1' }), /confirm must be "PROFILE1"/);
  await assert.rejects(session.deleteSlot({ kind: 'profile', slot: 2, confirm: 'PROFILE2' }), /slot 2 is already empty/);
  assert.equal(
    fake.received.some((r) => r.startsWith('clear')),
    false,
  );
  assert.match(await session.deleteSlot({ kind: 'ir', slot: 1, confirm: 'ir1' }), /Deleted user IR slot 1 "Mesa OS"/);
  assert.ok(fake.received.includes('clear ir 0'));
});

test('backup_all writes every user preset to one file, read without loading them', async () => {
  const { session, fake, dir } = setup();
  const text = await session.backupAll();
  const files = readdirSync(join(dir, 'backups'));
  assert.equal(files.length, 1);
  const backup = parseBackupFile(readFileSync(join(dir, 'backups', files[0]!), 'utf8'));
  assert.equal(backup.slots.length, 50);
  assert.equal(
    fake.received.some((r) => r.startsWith('select')),
    false,
  );
  assert.match(text, /Backed up P01\.\.P50 to /);
});

test('export writes the edit buffer to a preset file and never overwrites one', async () => {
  const { session, dir } = setup();
  await session.exportPreset('mine.json');
  assert.equal(JSON.parse(readFileSync(join(dir, 'presets', 'mine.json'), 'utf8')).format, 'pocket-master-preset');
  await assert.rejects(session.exportPreset('mine.json'), /already exists/);
});

test('import loads a preset file into the edit buffer without saving it', async () => {
  const { session, fake } = setup();
  const file = 'p08.json';
  await session.exportPreset(file);
  await session.select('P03');
  await session.importPreset(file);
  assert.equal(fake.current, 2, 'still on P03, nothing selected');
  assert.equal(
    fake.received.some((r) => r.startsWith('save')),
    false,
  );
  assert.deepEqual(decodePreset(fake.editBuffer), decodePreset(fake.slots[8]!));
});

test('import refuses a file that is not a preset', async () => {
  const { session, dir } = setup();
  await session.exportPreset('seed.json'); // creates the presets folder
  writeFileSync(join(dir, 'presets', 'x.json'), '{"hello":1}');
  await assert.rejects(session.importPreset('x.json'), /not a Pocket Master preset file/);
});

/** A synthetic .prst (the file Sonicake's app exports): magic, one unknown byte, FF x4, 16-byte name, dump without its 12 41. */
function prst(name: string, payload: Uint8Array): Uint8Array {
  const field = (text: string, size: number) => Array.from({ length: size }, (_, i) => text.charCodeAt(i) || 0);
  return Uint8Array.from([...field('Pocket Master', 20), 0x84, 0xff, 0xff, 0xff, 0xff, ...field(name, 16), ...payload.subarray(2)]);
}

test('a .prst from the Sonicake app is listed and imported like a preset file', async () => {
  const { session, fake, dir } = setup();
  await session.exportPreset('seed.json'); // creates the presets folder
  writeFileSync(join(dir, 'presets', 'sonic.prst'), prst('SONIC-LEAD', fake.slots[2]!));
  writeFileSync(join(dir, 'presets', 'broken.prst'), 'nope');
  const list = await session.listPresetFiles();
  assert.match(list, /- sonic\.prst: "SONIC-LEAD" \(\d{4}-\d\d-\d\d\)/);
  assert.match(list, /- broken\.prst: not a readable preset file/);
  assert.match(await session.importPreset('sonic.prst'), /Loaded "SONIC-LEAD"/);
  assert.deepEqual(decodePreset(fake.editBuffer), decodePreset(fake.slots[2]!));
  await assert.rejects(session.importPreset('broken.prst'), /not a Pocket Master \.prst file/);
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
  assert.equal(
    fake.received.some((r) => r.startsWith('save')),
    false,
  );
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

test('listModels without a block teaches the whole pedal: gear, description and parameters', async () => {
  const { session } = setup();
  const all = await session.listModels();
  for (const label of ['NR', 'FX1', 'DRV', 'AMP', 'IR', 'EQ', 'FX2', 'DLY', 'RVB']) assert.match(all, new RegExp(`^${label} models:`, 'm'));
  assert.match(all, /- Calif DualM: based on Mesa\/Boogie Dual Rectifier, Modern mode\. .*\n {4}params: Gain 0\.\.100/);
  assert.match(all, /- Scream: based on Ibanez TS-808 Tube Screamer\./);
  assert.match(all, /- Spring: Vintage amp spring reverb\./);
});

test('exported tones keep notes and are listed, so an approved tone is reused instead of rebuilt', async () => {
  const { session } = setup();
  assert.match(await session.listPresetFiles(), /No preset files yet/);
  await session.exportPreset('black-album.json', 'Metallica - Black Album rhythm, approved by ear');
  const list = await session.listPresetFiles();
  assert.match(list, /black-album\.json: ".*" — Metallica - Black Album rhythm, approved by ear/);
});

/** A tiny valid 16-bit mono WAV. */
function tinyWav(): Uint8Array {
  const buf = new Uint8Array(48);
  const v = new DataView(buf.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 40, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 44100, true);
  v.setUint32(28, 88200, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, 4, true);
  v.setInt16(44, 20000, true);
  return buf;
}
function putIr(dir: string, name: string, bytes = tinyWav()) {
  mkdirSync(join(dir, 'irs'), { recursive: true });
  writeFileSync(join(dir, 'irs', name), bytes);
}

test('load_ir puts a WAV from the irs folder into an empty user IR slot, named after the file', async () => {
  const { session, dir, uploads } = setup();
  putIr(dir, 'V30 Cab.wav');
  const text = await session.loadIr({ file: 'V30 Cab.wav', slot: 2, confirm: 'IR2' });
  assert.deepEqual(
    uploads.map(({ slot, name }) => [slot, name]),
    [[1, 'V30 Cab']],
  );
  assert.match(text, /Loaded "V30 Cab" into User IR 2/);
});

test('load_ir needs the slot confirmed and refuses to overwrite a loaded IR unless asked to', async () => {
  const { session, dir, uploads } = setup();
  putIr(dir, 'new.wav');
  await assert.rejects(session.loadIr({ file: 'new.wav', slot: 1, confirm: 'yes' }), /confirm must be "IR1"/);
  await assert.rejects(session.loadIr({ file: 'new.wav', slot: 1, confirm: 'IR1' }), /User IR 1 holds "Mesa OS".*cannot be backed up.*replace/);
  assert.equal(uploads.length, 0);
  await session.loadIr({ file: 'new.wav', slot: 1, confirm: 'IR1', replace: true, name: 'Fresh' });
  assert.deepEqual(
    uploads.map(({ slot, name }) => [slot, name]),
    [[0, 'Fresh']],
  );
});

test('load_ir checks the WAV and the folder before anything is sent', async () => {
  const { session, dir, uploads } = setup();
  putIr(dir, 'broken.wav', new TextEncoder().encode('not audio at all'));
  await assert.rejects(session.loadIr({ file: 'broken.wav', slot: 3, confirm: 'IR3' }), /not a WAV file/);
  await assert.rejects(session.loadIr({ file: '/etc/hosts', slot: 3, confirm: 'IR3' }), /inside .*irs/);
  await assert.rejects(session.loadIr({ file: 'missing.wav', slot: 3, confirm: 'IR3' }), /ENOENT|no such file/);
  await assert.rejects(session.loadIr({ file: 'x.wav', slot: 6, confirm: 'IR6' }), /slot must be 1\.\.5/);
  assert.equal(uploads.length, 0);
});

// --- TONE3000 and NAM --------------------------------------------------------
import type { Tone3000Api } from '../src/session.ts';
import type { Tone3000Store } from '../src/tone3000-store.ts';

function toneSetup(models: { id: number; name: string; bytes: Uint8Array }[]) {
  const base = setup();
  const dir = base.dir;
  const saved: string[] = [];
  let token: string | null = null;
  const store: Tone3000Store = {
    clientId: async () => 'pk',
    accessToken: async () => token,
    save: async (t) => {
      token = t.accessToken;
      saved.push(t.accessToken);
    },
  };
  const calls: string[] = [];
  const api: Tone3000Api = {
    startDeviceLogin: async () => ({
      deviceCode: 'D',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://www.tone3000.com/activate',
      verificationUriComplete: 'https://www.tone3000.com/activate?code=ABCD-EFGH',
      expiresIn: 600,
      interval: 5,
    }),
    pollDeviceToken: async () => ({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600_000 }),
    searchTones: async (_t, o) => {
      calls.push(`search ${o.query} ${o.format}`);
      return {
        page: 1,
        totalPages: 1,
        total: 1,
        tones: [
          {
            id: 42,
            title: 'GK 250ML',
            gear: 'amp',
            format: o.format ?? 'nam',
            makes: ['Gallien-Krueger'],
            creator: 'tonehead',
            modelsCount: models.length,
            downloads: 5,
            url: 'https://www.tone3000.com/tones/42',
            image: null,
            description: 'Somewhere in Time rhythm',
          },
        ],
      };
    },
    listModels: async () => models.map(({ id, name }) => ({ id, name, size: 'standard', url: `https://cdn.example/${id}`, architecture: '1' })),
    downloadModel: async (_t, url) => {
      calls.push(`download ${url}`);
      return models.find((m) => url.endsWith(`/${m.id}`))!.bytes;
    },
  };
  const converted: string[] = [];
  const convert = async (namJson: string) => {
    converted.push(namJson.slice(0, 20));
    return { arrayA: new Float32Array(128), arrayB: new Float32Array(2048), gains: [1, 1, 1, 1] as const };
  };
  const session = new Session(
    () => ({ io: (base as unknown as { fake: PedalIO }).fake, close: () => undefined }),
    { backups: join(dir, 'b'), presets: join(dir, 'p'), irs: join(dir, 'irs'), nams: join(dir, 'nams') },
    { tone3000: { store, api }, convert },
  );
  return { ...base, session, saved, calls, converted };
}

const namBytes = () => readFileSync(new URL('../../../packages/core/test/fixtures/clo/ref_input.nam', import.meta.url));

test('TONE3000 sign-in gives a link and code, then the approved token is kept', async () => {
  const t = toneSetup([]);
  await assert.rejects(t.session.searchTone3000({ query: 'gk' }), /call tone3000_login first/);
  const text = await t.session.tone3000Login();
  assert.match(text, /activate\?code=ABCD-EFGH.*ABCD-EFGH.*10 minutes/);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(t.saved, ['AT']);
  assert.match(await t.session.tone3000Login(), /Signed in to TONE3000 already/);
});

test('search lists tones with id, creator and link', async () => {
  const t = toneSetup([]);
  await t.session.tone3000Login();
  await new Promise((r) => setImmediate(r));
  const text = await t.session.searchTone3000({ query: 'gallien krueger 250ml' });
  assert.match(text, /- tone 42: "GK 250ML" by tonehead · amp · Gallien-Krueger · 0 model\(s\).*tones\/42/);
  assert.deepEqual(t.calls, ['search gallien krueger 250ml nam']);
});

test('installing a NAM tone converts it and writes the profile slot, after checking the slot', async () => {
  const t = toneSetup([{ id: 7, name: 'GK 250ML Lead Channel', bytes: namBytes() }]);
  await t.session.tone3000Login();
  await new Promise((r) => setImmediate(r));
  await assert.rejects(t.session.installTone({ toneId: 42, slot: 1, confirm: 'PROFILE1' }), /profile slot 1 holds "Randall SA".*replace/);
  assert.equal(t.converted.length, 0, 'no conversion for a refused slot');
  const text = await t.session.installTone({ toneId: 42, slot: 2, confirm: 'PROFILE2' });
  assert.equal(t.converted.length, 1);
  assert.deepEqual(
    t.uploads.map(({ slot, name, bytes }) => [slot, name, bytes]),
    [[1, 'GK 250ML Lead C', -1]],
  );
  assert.match(text, /loaded "GK 250ML Lead C" into profile slot 2/);
  await assert.rejects(t.session.installTone({ toneId: 42, slot: 3, confirm: 'IR3' }), /confirm must be "PROFILE3"/);
});

test('installing an IR tone writes a user IR slot, and a tone with several models asks which', async () => {
  const wavFile = tinyWav();
  const t = toneSetup([
    { id: 8, name: 'V30 4x12', bytes: wavFile },
    { id: 9, name: 'Greenback', bytes: wavFile },
  ]);
  await t.session.tone3000Login();
  await new Promise((r) => setImmediate(r));
  await assert.rejects(t.session.installTone({ toneId: 42, slot: 2, confirm: 'IR2' }), /several models; pass modelId:\n- model 8: V30 4x12/);
  await t.session.installTone({ toneId: 42, modelId: 9, slot: 2, confirm: 'IR2' });
  assert.deepEqual(
    t.uploads.map(({ slot, name }) => [slot, name]),
    [[1, 'Greenback']],
  );
});

test('load_nam converts a capture from the nams folder', async () => {
  const t = toneSetup([]);
  mkdirSync(join(t.dir, 'nams'), { recursive: true });
  writeFileSync(join(t.dir, 'nams', 'My AC30.nam'), namBytes());
  await t.session.loadNam({ file: 'My AC30.nam', slot: 3, confirm: 'PROFILE3' });
  assert.deepEqual(
    t.uploads.map(({ slot, name }) => [slot, name]),
    [[2, 'My AC30']],
  );
  await assert.rejects(t.session.loadNam({ file: '../escape.nam', slot: 3, confirm: 'PROFILE3' }), /inside .*nams/);
});

test('rename_slot renames a loaded slot and refuses an empty one', async () => {
  const { session, uploads } = setup();
  assert.match(await session.renameSlot({ kind: 'ir', slot: 1, name: 'Mesa 4x12' }), /from "Mesa OS" to "Mesa 4x12"/);
  assert.deepEqual(
    uploads.map(({ slot, name }) => [slot, name]),
    [[0, 'Mesa 4x12']],
  );
  await assert.rejects(session.renameSlot({ kind: 'profile', slot: 2, name: 'X' }), /slot 2 is empty/);
  await assert.rejects(session.renameSlot({ kind: 'ir', slot: 1, name: 'eleven chars' }), /1\.\.10 characters/);
});

test('get_global_settings reports the device-wide settings in words', async () => {
  const { session } = setup();
  const text = await session.getGlobals();
  assert.match(text, /Master volume 80/);
  assert.match(text, /Input -3 dB/);
  assert.match(text, /Backlight 6/);
  assert.match(text, /Boot anti-touch protection on/);
  // Smart Box settings the Pocket Master lacks are not shown even when a reply carries them.
  assert.doesNotMatch(text, /USB recording|re-amp|EXP\/FS|ECO|battery/i);
});

test('set_global_settings writes each change once and validates first', async () => {
  const { session, globalWrites } = setup();
  const text = await session.setGlobals({ inputLevel: 4, backlight: 8, bootProtection: 0 });
  assert.match(text, /Input level 4 dB, Backlight 8, Boot anti-touch protection off/);
  assert.deepEqual(globalWrites, [setGlobal('inputLevel', 4), setGlobal('backlight', 8), setGlobal('bootProtection', 0)]);
  await assert.rejects(session.setGlobals({ inputLevel: 30 }), /-20\.\.20/);
  await assert.rejects(session.setGlobals({}), /Nothing to change/);
  assert.equal(globalWrites.length, 3); // the refused calls sent nothing
});

test('undo puts the edit buffer back as it was before each edit, last first', async () => {
  const { session, fake } = setup();
  const original = fake.editBuffer.slice();
  await session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }]);
  const afterFirst = fake.editBuffer.slice();
  await session.edit([
    { kind: 'model', block: 'amp', model: 'Calif DualM' },
    { kind: 'block', block: 'dly', on: true },
  ]);
  assert.match(await session.undo(), /^Undid the last edit/);
  assert.deepEqual(fake.editBuffer, afterFirst);
  await session.undo();
  assert.deepEqual(fake.editBuffer, original);
  await assert.rejects(session.undo(), /Nothing to undo/);
});

test('undo refuses once the pedal is on another preset, and a revert or a load clears it', async () => {
  const { session } = setup();
  await session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }]);
  await session.select('P10');
  await assert.rejects(session.undo(), /Nothing to undo/);
  await session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 71 }]);
  await session.revert();
  await assert.rejects(session.undo(), /Nothing to undo/);
});

test('undo refuses when the preset changed on the pedal since the edit', async () => {
  const { session, fake } = setup();
  await session.edit([{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }]);
  await fake.selectPreset(9); // the preset knob on the unit
  await assert.rejects(session.undo(), /P10 is loaded now/);
});
