import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, parseFrame } from '../src/frame.ts';
import { PocketMasterLink, type MidiPort } from '../src/link.ts';
import { uploadUserIr, uploadUserProfile } from '../src/pedal.ts';
import { Reassembler } from '../src/reassembler.ts';

/** 12 20 / 12 24 reply: one flag per slot (0 loaded, 1 empty), then 16-byte names. */
function slotNamesReply(kind: number, names: (string | null)[]): Uint8Array {
  const payload = [0x12, kind, ...names.map((n) => (n ? 0 : 1))];
  for (const n of names) payload.push(...Array.from({ length: 16 }, (_, i) => (n && i < n.length ? n.charCodeAt(i) : 0)));
  return buildFrame(payload);
}

/** A port that answers like the pedal: session and name queries, acknowledges chunks, reports the flash write. */
function pedalPort(options: { commit?: boolean } = {}) {
  const names: (string | null)[] = ['Mesa OS', null, null, null, null];
  const profiles: (string | null)[] = ['Randall SA', null, null, null, null];
  const log: string[] = [];
  const upload = new Reassembler();
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  const reply = (bytes: Uint8Array) => queueMicrotask(() => receiver?.(bytes));
  const port: MidiPort = {
    listen: (r) => void (receiver = r),
    send: (bytes) => {
      const f = parseFrame(bytes);
      const [type, cmd] = f.payload;
      if (type === 0x12 && cmd === 0x30) {
        log.push('session');
        reply(buildFrame([0x12, 0x30, 0x01]));
        return;
      }
      if (type === 0x12 && cmd === 0x20) {
        log.push('names');
        reply(slotNamesReply(0x20, names));
        return;
      }
      if (type === 0x12 && cmd === 0x24) {
        log.push('profiles');
        reply(slotNamesReply(0x24, profiles));
        return;
      }
      log.push(`chunk ${f.index + 1}/${f.total}`);
      reply(buildFrame([0x14, 0x08, 0x00]));
      const blob = upload.feed(f, 0);
      if (blob && blob.payload[0] === 0x11 && (blob.payload[1] === 0x22 || blob.payload[1] === 0x26)) {
        const profile = blob.payload[1] === 0x26;
        (profile ? profiles : names)[blob.payload[2]!] = new TextDecoder().decode(blob.payload.subarray(6, 22)).replace(/\0+$/, '');
        setTimeout(() => receiver?.(buildFrame([0x12, 0x1b, profile ? 0x03 : 0x04, 0, 0, 0])), 5);
      }
      if (blob && blob.payload[0] === 0x11 && (blob.payload[1] === 0x23 || blob.payload[1] === 0x27)) {
        const profile = blob.payload[1] === 0x27;
        (profile ? profiles : names)[blob.payload[2]!] = null;
        setTimeout(() => receiver?.(buildFrame([0x12, 0x1b, profile ? 0x03 : 0x04, 0, 0, 0])), 5);
      }
      if (blob && blob.payload[0] === 0x11 && (blob.payload[1] === 0x21 || blob.payload[1] === 0x25)) {
        const profile = blob.payload[1] === 0x25;
        (profile ? profiles : names)[blob.payload[6]!] = new TextDecoder().decode(blob.payload.subarray(10, profile ? 25 : 20)).replace(/\0+$/, '');
        if (options.commit !== false) setTimeout(() => receiver?.(buildFrame([0x12, 0x1b, profile ? 0x03 : 0x04, 0, 0, 0])), 5);
      }
    },
  };
  return { port, log, names, profiles };
}

function wav(): Uint8Array {
  const buf = new Uint8Array(46);
  const v = new DataView(buf.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 38, true);
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
  v.setUint32(40, 2, true);
  v.setInt16(44, 12345, true);
  return buf;
}

test('uploading a user IR opens the session, reads the names, sends every chunk and checks the new name', async () => {
  const pedal = pedalPort();
  const link = new PocketMasterLink(pedal.port, () => undefined);
  const names = await uploadUserIr(link, 1, 'V30 Cab', wav());
  link.close();
  assert.equal(names[1]?.name, 'V30 Cab');
  assert.deepEqual(pedal.log.slice(0, 3), ['session', 'names', 'chunk 1/112']);
  assert.equal(pedal.log.filter((l) => l.startsWith('chunk')).length, 112);
  assert.equal(pedal.log.at(-1), 'names');
});

test('an upload the pedal does not write fails, and a bad WAV fails before anything is sent', async () => {
  const pedal = pedalPort({ commit: false });
  const link = new PocketMasterLink(pedal.port, () => undefined);
  await assert.rejects(uploadUserIr(link, 1, 'X', new Uint8Array(10)), /not a WAV file/);
  assert.deepEqual(pedal.log, []);
  await assert.rejects(uploadUserIr(link, 1, 'X', wav()), /not saved/);
  link.close();
});

test('uploading a converted capture writes the profile slot and checks its new name', async () => {
  const pedal = pedalPort();
  const link = new PocketMasterLink(pedal.port, () => undefined);
  const arrays = { arrayA: new Float32Array(128), arrayB: new Float32Array(2048), gains: [1, 1, 1, 1] as const };
  const names = await uploadUserProfile(link, 2, 'GK 250ML clone', arrays);
  link.close();
  assert.equal(names[2]?.name, 'GK 250ML clone');
  assert.deepEqual(pedal.log.slice(0, 3), ['session', 'profiles', 'chunk 1/146']);
  assert.equal(pedal.log.at(-1), 'profiles');
});

test('renaming a user IR or a profile slot sends the short rename blob and checks the new name', async () => {
  const { renameUserIr, renameUserProfile } = await import('../src/pedal.ts');
  const pedal = pedalPort();
  const link = new PocketMasterLink(pedal.port, () => undefined);
  const irs = await renameUserIr(link, 0, 'Mesa 4x12');
  assert.equal(irs[0]?.name, 'Mesa 4x12');
  const profiles = await renameUserProfile(link, 0, 'Randall Lead');
  link.close();
  assert.equal(profiles[0]?.name, 'Randall Lead');
  assert.deepEqual(
    pedal.log.filter((l) => l.startsWith('chunk')),
    ['chunk 1/2', 'chunk 2/2', 'chunk 1/2', 'chunk 2/2'],
  );
});

test('clearing a profile slot sends the official tool frame byte for byte (SonicMaster golden)', async () => {
  const { chunkFrames } = await import('../src/ir-upload.ts');
  const { profileClearBlob } = await import('../src/clo/codec.ts');
  const { irClearBlob } = await import('../src/ir-upload.ts');
  const { toHex } = await import('../src/hex.ts');
  assert.deepEqual(
    chunkFrames(profileClearBlob(2)).map((f) => toHex(f).replace(/ /g, '')),
    ['F0040E00010000000601010207000200000000000FF7'],
  );
  assert.deepEqual(Array.from(irClearBlob(3)), [0x11, 0x23, 3, 0x00, 0x10, 0x0a]);
  assert.throws(() => irClearBlob(5), /slot/);
});

test('clearing a user IR or a profile slot empties it and checks the pedal reports it empty', async () => {
  const { clearUserIr, clearUserProfile } = await import('../src/pedal.ts');
  const pedal = pedalPort();
  const link = new PocketMasterLink(pedal.port, () => undefined);
  const irs = await clearUserIr(link, 0);
  assert.equal(irs[0]?.empty, true);
  const profiles = await clearUserProfile(link, 0);
  link.close();
  assert.equal(profiles[0]?.empty, true);
  assert.deepEqual(
    pedal.log.filter((l) => l.startsWith('chunk')),
    ['chunk 1/1', 'chunk 1/1'],
  );
});
