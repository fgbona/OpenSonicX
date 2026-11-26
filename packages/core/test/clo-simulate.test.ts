/**
 * The offline CLONE block (simulate.ts): a capture it can be checked by hand on, and the Matribox
 * conversion of a public .nam played through it against the model itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeClo } from '../src/clo/codec.ts';
import { Fft } from '../src/clo/fft.ts';
import { parseNam } from '../src/clo/nam.ts';
import { resample } from '../src/clo/resample.ts';
import { checkClo, cloProbe, simulateClo } from '../src/clo/simulate.ts';
import { diAtRate, generateMatriboxClo, renderTarget } from '../src/clo/startclone.ts';
import { noise, sectionsDi } from './clo-sections-di.ts';

const impulse = (n: number, gain = 1) => Float32Array.from({ length: n }, (_, i) => (i === 0 ? gain : 0));
const rms = (s: ArrayLike<number>) => Math.sqrt(Array.from(s).reduce((t, v) => t + v * v, 0) / s.length);
const db = (v: number) => 20 * Math.log10(v);
const IDENTITY = [1, 0, 0, 0, 0];
const N = 4096;
const BANDS = [100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000];

/** Average power per 1/3 octave (dB) of a 44.1 kHz signal, over 4096-sample segments. */
function thirds(x: readonly number[]): number[] {
  const power = new Float64Array(N / 2);
  for (let at = 0; at + N <= x.length; at += N) {
    const re = Float64Array.from(x.slice(at, at + N));
    const im = new Float64Array(N);
    new Fft(N).transform(re, im, false);
    for (let k = 0; k < N / 2; k++) power[k]! += re[k]! ** 2 + im[k]! ** 2;
  }
  return BANDS.map((f) => {
    const lo = Math.round(((f / 2 ** (1 / 6)) * N) / 44100);
    const hi = Math.max(lo + 1, Math.round((f * 2 ** (1 / 6) * N) / 44100));
    return 10 * Math.log10(power.subarray(lo, hi).reduce((s, v) => s + v, 0) / (hi - lo));
  });
}

test('small signals pass the saturator at A k: impulse IRs make a plain gain', () => {
  // gains A+ A- k+ k-: the small-signal slope is A k = 0.1 x 10 = 1
  const clo = encodeClo({ arrayA: impulse(128, 0.5), arrayB: impulse(2048, 2), gains: [0.1, 0.1, 10, 10], biquad: IDENTITY });
  const x = Float32Array.from(noise(4096, 0.001));
  const y = simulateClo(clo, x);
  assert.equal(y.length, 4096);
  const gain = rms(y.subarray(256)) / rms(x.subarray(256)); // after the resamplers' settling
  assert.ok(Math.abs(db(gain)) < 0.1, `gain ${db(gain).toFixed(3)} dB`);
});

test('loud signals saturate at A, per polarity', () => {
  const clo = encodeClo({ arrayA: impulse(128), arrayB: impulse(2048), gains: [0.2, 0.05, 100, 100], biquad: IDENTITY });
  const y = simulateClo(clo, new Float32Array(2048).fill(0.5));
  assert.ok(Math.abs(y[2000]! - 0.2) < 1e-3, `positive ${y[2000]}`);
  const n = simulateClo(clo, new Float32Array(2048).fill(-0.5));
  assert.ok(Math.abs(n[2000]! + 0.05) < 1e-3, `negative ${n[2000]}`);
});

test('a capture without IR lengths plays silence, as the unit does; checkClo refuses it and a clipping one', () => {
  const clo = encodeClo({ arrayA: impulse(128), arrayB: impulse(2048), gains: [0.1, 0.1, 10, 10] });
  const empty = clo.slice();
  empty.fill(0, 0x7c, 0x80);
  const probe = Float32Array.from(noise(8192, 0.1));
  assert.ok(simulateClo(empty, probe).every((v) => v === 0));
  assert.equal(checkClo(empty, probe).problem, 'silent');
  const loud = encodeClo({ arrayA: impulse(128), arrayB: impulse(2048, 50), gains: [0.1, 0.1, 10, 10] });
  assert.equal(checkClo(loud, probe).problem, 'clipped');
  assert.equal(checkClo(clo, probe).ok, true);
});

test('the Matribox conversion of ref_input.nam plays like the model through the simulated CLONE block', { timeout: 300_000 }, () => {
  const namJson = readFileSync(new URL('./fixtures/clo/ref_input.nam', import.meta.url), 'utf8');
  const model = parseNam(namJson);
  const fs = model.sampleRate ?? 48000;
  const progress: number[] = [];
  const clo = encodeClo(generateMatriboxClo(namJson, Float32Array.from(sectionsDi(44100)), (f) => progress.push(f)));
  assert.ok(progress.length > 2 && progress.every((f, i) => f > (progress[i - 1] ?? 0)), `progress ${progress}`);
  assert.equal(progress.at(-1), 1);
  // a short synthetic DI at a guitar's level, 44.1 kHz
  const di = Float32Array.from(noise(44100, 0.05, 7));
  const played = simulateClo(clo, di);
  // the model on the same DI, at its own rate, back to 44.1 kHz; the clone plays its output x 0.31 x 4
  const target = resample(renderTarget(model, diAtRate(di, fs)), 44100, fs).map((v) => v * 4);
  const span = (s: ArrayLike<number>) => Array.from(s).slice(4410, 44000);
  const [a, b] = [span(played), span(target)];
  const level = db(rms(a) / rms(b));
  const pa = thirds(a);
  const pb = thirds(b);
  const diffs = BANDS.map((f, i) => [f, pa[i]! - pb[i]! - level] as const);
  // loose: the fit is judged on the reference DI's sections, this DI is plain noise (measured: +0.2 .. +5.3 dB, the bass high)
  for (const [f, d] of diffs) assert.ok(Math.abs(d) < 6, `${f} Hz: ${d.toFixed(1)} dB off the level`);
  assert.ok(Math.abs(level) < 3, `level ${level.toFixed(2)} dB`);
  assert.equal(checkClo(clo, cloProbe()).ok, true);
});
