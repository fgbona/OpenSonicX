/**
 * The user IR upload message against the official editor's uploads of two WAVs made for it (our
 * own synthetic files, committed: fixtures/matribox-ir). The editor compressed those messages for
 * real; we send literals, so the decompressed data is compared, not the frames (the frames of a
 * real IR, which the editor sent as literals, are compared by matribox-ir-capture.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinMbPages, parseMbFrame } from '../src/matribox/frame.ts';
import { MB_IR_CHECKSUM_SAMPLES, mbIrUpload, mbIrUploadData } from '../src/matribox/ir.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { fromHex, toHex } from '../src/hex.ts';

const fixture = (name: string) => new URL(`./fixtures/matribox-ir/${name}`, import.meta.url);
const wav = (name: string) => new Uint8Array(readFileSync(fixture(`${name}.wav`)));
const unwrap = (frames: readonly Uint8Array[]) => {
  const joined = joinMbPages(frames.map(parseMbFrame));
  assert.ok(joined);
  return unwrapMbMessage(joined);
};
const captured = (name: string) =>
  unwrap(
    readFileSync(fixture(`${name}.upload.txt`), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('F0'))
      .map(fromHex),
  );
const u32At = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset).getUint32(at, true);

for (const [name, slot, checksum] of [
  ['teste-silencio', 6, 1454],
  ['teste-impulso', 7, 167606],
] as const) {
  test(`${name}: the data is the official editor's byte for byte (checksum ${checksum})`, () => {
    const want = captured(name);
    assert.equal(want.flag, 1);
    assert.equal(want.cmd, 0x14);
    const data = mbIrUploadData(slot, name, wav(name));
    assert.equal(u32At(data, 8), checksum);
    assert.equal(toHex(data), toHex(want.data));
  });
}

test('mbIrUpload pages the message as literals: flag 1, cmd 0x14, 23 pages', () => {
  const frames = mbIrUpload(7, 'teste-impulso', wav('teste-impulso'));
  assert.equal(frames.length, 23);
  const message = unwrap(frames);
  assert.equal(message.flag, 1);
  assert.equal(message.cmd, 0x14);
  assert.equal(toHex(message.data), toHex(captured('teste-impulso').data));
  assert.equal(MB_IR_CHECKSUM_SAMPLES, 1366);
});

test('slot and name are checked', () => {
  const w = wav('teste-silencio');
  assert.throws(() => mbIrUploadData(20, 'a', w), /slot/);
  assert.throws(() => mbIrUploadData(-1, 'a', w), /slot/);
  assert.throws(() => mbIrUploadData(0, '', w), /name/);
  assert.throws(() => mbIrUploadData(0, '   ', w), /name/);
  assert.throws(() => mbIrUploadData(0, 'x'.repeat(17), w), /name/);
  assert.throws(() => mbIrUploadData(0, 'café', w), /name/);
});
