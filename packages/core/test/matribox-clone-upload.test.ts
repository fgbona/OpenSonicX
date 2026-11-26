/**
 * The clone upload (flag 1, cmd 0x18, 49 pages) and rename (flag 2, cmd 0x18) against the simulated
 * unit: the message layout of capture mb-19, the flag-3 acknowledgement, the names read back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeClo } from '../src/clo/codec.ts';
import { joinMbPages, parseMbFrame } from '../src/matribox/frame.ts';
import { mbCloneUpload, mbCloneUploadData, mbRenameClone, mbUploadClone, type MbCloneStep } from '../src/matribox/clone.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { FakeMatribox } from './fake-matribox.ts';

const clo = encodeClo({
  arrayA: Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? 0.5 : 0)),
  arrayB: Float32Array.from({ length: 2048 }, (_, i) => 0.9 ** i),
  gains: [0.0858, 0.0863, 747, 753],
});
const link = (fake: FakeMatribox) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 1000);
const u32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset).getUint32(at, true);

test("the upload is mb-19's layout: slot, 0, byte sum of the .clo, 20-byte name, the .clo; 49 pages of flag 1 cmd 0x18", () => {
  const data = mbCloneUploadData(9, '5 RECTIFIER', clo);
  assert.equal(data.length, 8872);
  assert.equal(u32(data, 0), 9);
  assert.equal(u32(data, 4), 0);
  assert.equal(
    u32(data, 8),
    clo.reduce((s, b) => s + b, 0),
  );
  assert.equal(new TextDecoder().decode(data.subarray(12, 32)).replace(/\0+$/, ''), '5 RECTIFIER');
  assert.deepEqual(data.subarray(32), clo);
  const frames = mbCloneUpload(9, '5 RECTIFIER', clo);
  assert.equal(frames.length, 49);
  const message = unwrapMbMessage(joinMbPages(frames.map(parseMbFrame)) as Uint8Array);
  assert.deepEqual([message.flag, message.cmd], [1, 0x18]);
  assert.deepEqual(message.data, data);
});

test('slot, name and .clo are checked before anything is built', () => {
  assert.throws(() => mbCloneUploadData(10, 'a', clo), /slot/);
  assert.throws(() => mbCloneUploadData(0, '', clo), /name/);
  assert.throws(() => mbCloneUploadData(0, 'x'.repeat(17), clo), /name/);
  assert.throws(() => mbCloneUploadData(0, 'a', clo.slice(0, 100)), /8840/);
  const bad = clo.slice();
  bad[700] = (bad[700] ?? 0) ^ 1;
  assert.throws(() => mbCloneUploadData(0, 'a', bad), /CRC/);
  assert.throws(() => mbRenameClone(-1, 'a'), /slot/);
});

test('mbUploadClone uploads, checks status 1, renames and reads the name back', async () => {
  const fake = new FakeMatribox();
  const steps: MbCloneStep[] = [];
  const names = await mbUploadClone(link(fake), 8, clo, { name: 'OSX RECTIFIER', onProgress: (s) => steps.push(s) });
  assert.equal(names[8], 'OSX RECTIFIER');
  assert.deepEqual(steps, ['sending', 'stored', 'renaming', 'checked']);
  assert.equal(fake.cloneUploads.length, 1);
  assert.deepEqual(fake.cloneUploads[0]?.subarray(32), clo);
  // never a clone delete (flag 1 cmd 0x11 sub 0x9000|n) nor the bootloader message (flag 0x0E cmd 0x05)
  for (const hex of fake.received) {
    const page = parseMbFrame(Uint8Array.from(hex.match(/../g)!.map((h) => Number.parseInt(h, 16))));
    if (page.offset > 0) continue;
    assert.notEqual(page.payload[0], 0x0e);
  }
});

test('without a name the upload is named "Capture n" and no rename is sent', async () => {
  const fake = new FakeMatribox();
  const names = await mbUploadClone(link(fake), 2, clo);
  assert.equal(names[2], 'Capture 3');
  assert.equal(fake.received.length, 49 + 1); // the pages and the names read
});

test('a status other than 1 is an error and nothing is renamed', async () => {
  const fake = new FakeMatribox();
  fake.cloneStatus = 0;
  await assert.rejects(mbUploadClone(link(fake), 0, clo, { name: 'X' }), /did not store.*status 0/);
  assert.equal(fake.received.length, 49);
});

test('no acknowledgement times out', async () => {
  const fake = new FakeMatribox();
  fake.echoes = false;
  await assert.rejects(mbUploadClone(link(fake), 0, clo, { timeoutMs: 50 }), /acknowledge the upload.*50 ms/);
});
