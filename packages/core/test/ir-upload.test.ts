import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame } from '../src/frame.ts';
import { chunkFrames, IR_TAPS, irRenameBlob, irSamplesFromWav, irUploadBlob, isUploadBlob, UploadDomain } from '../src/ir-upload.ts';

const INT24_MAX = (1 << 23) - 1;

/** A minimal RIFF/WAVE file. `write` fills one sample of one channel. */
function wav(opts: { rate?: number; bits: number; channels?: number; format?: number; frames: number; write: (v: DataView, at: number, frame: number, channel: number) => void }): Uint8Array {
  const { rate = 44100, bits, channels = 1, format = bits === 32 && opts.format === 3 ? 3 : (opts.format ?? 1), frames } = opts;
  const bytesPer = bits / 8;
  const dataLen = frames * channels * bytesPer;
  const buf = new Uint8Array(44 + dataLen);
  const v = new DataView(buf.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, format, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * bytesPer, true); v.setUint16(32, channels * bytesPer, true); v.setUint16(34, bits, true);
  tag(36, 'data'); v.setUint32(40, dataLen, true);
  for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) opts.write(v, 44 + (f * channels + c) * bytesPer, f, c);
  return buf;
}

test('a 16-bit mono 44.1 kHz WAV becomes 512 int24 taps, padded with silence', () => {
  const s = irSamplesFromWav(wav({ bits: 16, frames: 3, write: (v, at, f) => v.setInt16(at, [16384, -32768, 0][f]!, true) }));
  assert.equal(s.length, IR_TAPS);
  assert.deepEqual([...s.slice(0, 4)], [Math.round(0.5 * INT24_MAX), -INT24_MAX, 0, 0]);
});

test('stereo is averaged to mono; 24-bit and float32 are read; longer IRs are cut at 512 taps', () => {
  const stereo = irSamplesFromWav(wav({ bits: 24, channels: 2, frames: 600, write: (v, at, _f, c) => {
    const x = c === 0 ? 0x400000 : 0; // +0.5 on the left, 0 on the right
    v.setUint8(at, x & 0xff); v.setUint8(at + 1, (x >> 8) & 0xff); v.setUint8(at + 2, (x >> 16) & 0xff);
  } }));
  assert.equal(stereo.length, IR_TAPS);
  assert.equal(stereo[0], Math.round(0.25 * INT24_MAX));
  const float = irSamplesFromWav(wav({ bits: 32, format: 3, frames: 2, write: (v, at, f) => v.setFloat32(at, f === 0 ? 1.5 : -0.25, true) }));
  assert.equal(float[0], INT24_MAX, 'clipped to full scale');
  assert.equal(float[1], Math.round(-0.25 * INT24_MAX));
});

test('other sample rates are resampled to 44.1 kHz', () => {
  const s = irSamplesFromWav(wav({ rate: 22050, bits: 16, frames: 4, write: (v, at, f) => v.setInt16(at, f === 1 ? 16384 : 0, true) }));
  // 22.05 kHz -> 44.1 kHz doubles the length; the impulse at frame 1 lands at tap 2, with a linear ramp
  assert.deepEqual([...s.slice(0, 5)].map((x) => Math.round((x / INT24_MAX) * 100) / 100), [0, 0.25, 0.5, 0.25, 0]);
});

test('files that are not usable WAVs are refused with a reason', () => {
  assert.throws(() => irSamplesFromWav(new TextEncoder().encode('hello world, not audio')), /not a WAV file/);
  assert.throws(() => irSamplesFromWav(wav({ rate: 4000, bits: 16, frames: 2, write: () => undefined })), /sample rate 4000/);
  assert.throws(() => irSamplesFromWav(wav({ bits: 12, frames: 2, write: () => undefined })), /bit depth 12/);
});

test('the IR blob is magic 11 21, slot, name and 512 little-endian int24 samples', () => {
  const samples = Int32Array.from({ length: IR_TAPS }, (_, i) => (i === 0 ? -1 : i));
  const blob = irUploadBlob(2, 'Mesa OS', samples);
  assert.equal(blob.length, 74 + IR_TAPS * 4);
  assert.deepEqual([...blob.slice(0, 10)], [0x11, 0x21, 0, 0, 0, 0, 2, 0, 0x10, 0x0a]);
  assert.equal(new TextDecoder().decode(blob.slice(10, 17)), 'Mesa OS');
  assert.ok(blob.slice(17, 74).every((b) => b === 0));
  const view = new DataView(blob.buffer);
  assert.equal(view.getInt32(74, true), -1);
  assert.equal(view.getInt32(74 + 4 * 5, true), 5);
  assert.throws(() => irUploadBlob(5, 'X', samples), /slot must be 0\.\.4/);
  assert.throws(() => irUploadBlob(0, '', samples), /1\.\.10 characters/);
  assert.throws(() => irUploadBlob(0, 'X', samples.slice(1)), /512 samples/);
});

test('renaming is a short blob 11 22 with a 16-byte name field', () => {
  assert.deepEqual([...irRenameBlob(4, 'Holy')], [0x11, 0x22, 4, 0, 0x10, 0x0a, ...[...'Holy'].map((c) => c.charCodeAt(0)), ...Array(12).fill(0)]);
});

test('a blob travels as 19-byte chunks numbered 0..n-1 of n, and only IR blobs are accepted', () => {
  const blob = irUploadBlob(0, 'IR', new Int32Array(IR_TAPS));
  const frames = chunkFrames(blob);
  assert.equal(frames.length, Math.ceil(blob.length / 19));
  const parsed = frames.map(parseFrame);
  assert.ok(parsed.every((f, i) => f.crcOk && f.total === frames.length && f.index === i));
  assert.deepEqual(Buffer.concat(parsed.map((f) => f.payload)), Buffer.from(blob));
  assert.ok(isUploadBlob(blob, UploadDomain.IR));
  assert.ok(isUploadBlob(irRenameBlob(0, 'X'), UploadDomain.IR));
  assert.equal(isUploadBlob(Uint8Array.of(0x11, 0x4a, 0, 0), UploadDomain.IR), false, 'a save is not an upload');
  assert.equal(isUploadBlob(Uint8Array.of(0x11, 0x23, 0, 0, 0x10, 0x0a), UploadDomain.IR), false, 'clearing a slot is not offered');
});
