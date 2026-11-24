import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MB_IR_TAPS, mbIrSamplesFromWav } from '../src/matribox/ir.ts';

/** A PCM WAV of int samples (`bits` 16 or 24) or float32 (`bits` 32), `channels` interleaved. */
function wav(rate: number, bits: 16 | 24 | 32, frames: readonly (readonly number[])[]): Uint8Array {
  const channels = frames[0]?.length ?? 1;
  const bytesPer = bits / 8;
  const size = frames.length * channels * bytesPer;
  const buf = new Uint8Array(44 + size);
  const v = new DataView(buf.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => (buf[at + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + size, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * bytesPer, true);
  v.setUint16(32, channels * bytesPer, true);
  v.setUint16(34, bits, true);
  tag(36, 'data');
  v.setUint32(40, size, true);
  let at = 44;
  for (const frame of frames) {
    for (const s of frame) {
      if (bits === 16) v.setInt16(at, s, true);
      else if (bits === 24) [s & 0xff, (s >> 8) & 0xff, (s >> 16) & 0xff].forEach((b, i) => (buf[at + i] = b));
      else v.setFloat32(at, s, true);
      at += bytesPer;
    }
  }
  return buf;
}

const hash = (s: Int32Array) =>
  createHash('sha256')
    .update(new Uint8Array(s.buffer, s.byteOffset, s.byteLength))
    .digest('hex');

test('a 44.1 kHz IR is kept sample for sample, through the official tool float -> int24 rounding', () => {
  const s = [0, 1, 4194303, 4194304, 4194305, 8388607, -1, -8388608];
  const out = mbIrSamplesFromWav(
    wav(
      44100,
      24,
      s.map((x) => [x]),
    ),
  );
  assert.equal(out.length, MB_IR_TAPS);
  // round(x * (2^31 - 1)) >> 8 in doubles, ties to even: some large positive samples lose one LSB
  assert.deepEqual([...out.subarray(0, 8)], [0, 1, 4194303, 4194304, 4194305, 8388606, -1, -8388608]);
  assert.ok(
    out.subarray(8).every((x) => x === 0),
    'a short IR is padded with silence',
  );
});

test('only the first channel is used, like the official tool', () => {
  const out = mbIrSamplesFromWav(
    wav(44100, 16, [
      [1000, -5000],
      [2000, 7000],
    ]),
  );
  assert.deepEqual([...out.subarray(0, 3)], [1000 * 256, 2000 * 256, 0]);
});

test('float WAVs clip at full scale', () => {
  const out = mbIrSamplesFromWav(wav(44100, 32, [[1.5], [-2], [0.5]]));
  assert.deepEqual([...out.subarray(0, 3)], [8388607, -8388608, 4194304]);
});

test('48 kHz goes through the r8brain 1.6 resampler (regression pin; byte-exact with the capture locally)', () => {
  const impulse = Array.from({ length: 2000 }, (_, i) => [i === 0 ? 8000000 : 0]);
  const out = mbIrSamplesFromWav(wav(48000, 24, impulse));
  assert.deepEqual([...out.subarray(0, 4)], [7219234, 253119, -94148, 133697]); // the low-pass kernel, centred on the impulse
  assert.equal(hash(out), IMPULSE_HASH);
  const dc = mbIrSamplesFromWav(
    wav(
      48000,
      24,
      Array.from({ length: 4000 }, () => [4000000]),
    ),
  );
  assert.ok(
    dc.subarray(500, 1000).every((x) => Math.abs(x - 4000000) <= 1),
    'unity gain once the step has rung out',
  );
});

test('rates other than 44.1 and 48 kHz, and non-WAV input, are refused', () => {
  assert.throws(() => mbIrSamplesFromWav(wav(96000, 24, [[0]])), /44\.1 or 48 kHz/);
  assert.throws(() => mbIrSamplesFromWav(new Uint8Array(20)), /WAV/);
});

const IMPULSE_HASH = 'd36973041f4a053af74fe1db3fbf23e6f3edbebdb8cac3d39eead65c81dd4d5a';
