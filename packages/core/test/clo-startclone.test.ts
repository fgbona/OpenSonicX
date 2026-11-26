import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLO_BIQUAD, decodeClo, encodeClo } from '../src/clo/codec.ts';
import { parseNam } from '../src/clo/nam.ts';
import { convolve, dft, hpf40, iirRun, interp1, linspace, minPhase, sat4x, smoothdata, smoothFreq, tfestimate } from '../src/clo/startclone-dsp.ts';
import { runWavenetBlocks, startClone, startCloneArrays } from '../src/clo/startclone.ts';
import { noise, sectionsDi } from './clo-sections-di.ts';

const close = (got: number, want: number, tol: number, what = '') => assert.ok(Math.abs(got - want) <= tol, `${what} ${got} vs ${want} (tol ${tol})`);
const db = (v: number) => 20 * Math.log10(v);

/** |H(e^jw)| of an FIR at `bins` points from 0 to Nyquist. */
const firMag = (h: readonly number[], bins: number) =>
  Float64Array.from({ length: bins }, (_, k) => {
    const w = (Math.PI * k) / (bins - 1);
    let re = 0;
    let im = 0;
    h.forEach((v, n) => {
      re += v * Math.cos(w * n);
      im -= v * Math.sin(w * n);
    });
    return Math.hypot(re, im);
  });

test('IIR 2 at 48 kHz is the 40 Hz high-pass every .clo carries', () => {
  const q = hpf40(48000);
  [q.b0, q.b1, q.b2, q.a1, q.a2].forEach((c, i) => close(c, CLO_BIQUAD[i]!, 1e-9, `coefficient ${i}`));
});

test('a .clo stores the biquad it is given, else the 48 kHz one', () => {
  const arrays = { arrayA: new Float32Array(128), arrayB: new Float32Array(2048), gains: [0.1, 0.1, 700, 700] as const };
  assert.deepEqual(decodeClo(encodeClo(arrays)).biquad, [...CLO_BIQUAD]);
  const q = hpf40(44100);
  assert.deepEqual(decodeClo(encodeClo({ ...arrays, biquad: [q.b0, q.b1, q.b2, q.a1, q.a2] })).biquad, [q.b0, q.b1, q.b2, q.a1, q.a2]);
});

test('dft of a size that is not a power of two matches the definition', () => {
  const re = Float64Array.from([1, 2, 0, -1, 0.5, 3]);
  const { re: R, im: I } = dft(re, new Float64Array(6), false);
  for (let k = 0; k < 6; k++) {
    let sr = 0;
    let si = 0;
    re.forEach((v, t) => {
      sr += v * Math.cos((2 * Math.PI * k * t) / 6);
      si -= v * Math.sin((2 * Math.PI * k * t) / 6);
    });
    close(R[k]!, sr, 1e-12);
    close(I[k]!, si, 1e-12);
  }
});

test('convolve is linear convolution from rest, as long as the input', () => {
  const x = Float64Array.from({ length: 20000 }, (_, i) => Math.sin(i * 0.01) + (i % 7) * 0.1);
  const h = Float64Array.from({ length: 300 }, (_, i) => Math.exp(-i / 40) * (i % 2 ? -1 : 1));
  const y = convolve(x, h);
  assert.equal(y.length, x.length);
  for (const i of [0, 1, 299, 5000, 19999]) {
    let want = 0;
    for (let k = 0; k <= Math.min(i, 299); k++) want += h[k]! * x[i - k]!;
    close(y[i]!, want, 1e-9, `sample ${i}`);
  }
});

test('minPhase rebuilds a minimum-phase FIR from its magnitude', () => {
  const h = minPhase(firMag([1, -0.9], 1025), 128);
  close(h[0]!, 1, 0.01, 'tap 0');
  close(h[1]!, -0.9, 0.01, 'tap 1');
  for (let i = 2; i < 128; i++) assert.ok(Math.abs(h[i]!) < 0.01, `tap ${i} = ${h[i]}`);
  // DC removed: the taps sum to zero
  close(
    h.reduce((s, v) => s + v, 0),
    0,
    1e-9,
  );
});

test('minPhase works on the 128- and 256-bin grids too (non power-of-two transforms)', () => {
  for (const bins of [128, 256]) {
    const h = minPhase(firMag([0.6, 0.3, 0.1], bins), 64);
    close(h[0]!, 0.6, 0.02, `${bins} bins tap 0`);
    close(h[1]!, 0.3, 0.02, `${bins} bins tap 1`);
  }
});

test('interp1 interpolates, extrapolates to the right and gives FLT_MAX on the left', () => {
  const x = Float64Array.from([0, 1, 3]);
  const y = Float64Array.from([0, 2, 4]);
  const got = interp1(x, y, Float64Array.from([-1, 0, 0.5, 2, 3, 5]));
  assert.ok(got[0]! > 3e38);
  assert.deepEqual(Array.from(got.subarray(1)), [0, 1, 3, 4, 6]);
});

test('smoothdata keeps a constant, preserves an impulse area and zeroes on w < 1', () => {
  const c = smoothdata(new Float64Array(50).fill(3), 7);
  for (const v of c) close(v, 3, 1e-9);
  const imp = new Float64Array(50);
  imp[25] = 1;
  close(
    smoothdata(imp, 9).reduce((s, v) => s + v, 0),
    1,
    1e-9,
  );
  assert.ok(smoothdata(imp, 0).every((v) => v === 0));
});

test('smoothFreq keeps a flat magnitude and resamples onto a linear grid', () => {
  const f = linspace(0, 24000, 1025);
  const { mag, freq } = smoothFreq(new Float64Array(1025).fill(2), f, 128);
  assert.equal(mag.length, 128);
  assert.equal(freq[0], 0);
  assert.equal(freq[127], 24000);
  for (const v of mag) close(v, 2, 1e-9);
});

test('tfestimate measures a known filter on white noise', () => {
  const fs = 48000;
  const h = [0.5, 0.3, -0.2];
  const x = noise(fs * 4, 0.1);
  const y = convolve(x, Float64Array.from(h));
  const { mag, freq } = tfestimate(x, y, x.length, Math.trunc(fs * 0.125 + 0.5), fs);
  const want = firMag(h, 1025);
  assert.equal(freq[1024], fs / 2);
  for (const k of [10, 100, 400, 800, 1000]) close(db(mag[k]!), db(want[k]!), 0.3, `bin ${k}`);
});

test('sat4x saturates towards A(1 - e^(-k x)) per polarity and passes small signals at A k', () => {
  const p = { apos: 0.1, aneg: 0.2, kp: 50, kn: 20 };
  const pos = sat4x(new Float64Array(400).fill(0.05), p);
  close(pos[399]!, 0.1 * (1 - Math.exp(-2.5)), 1e-6, 'positive DC');
  const neg = sat4x(new Float64Array(400).fill(-0.05), p);
  close(neg[399]!, -0.2 * (1 - Math.exp(-1)), 1e-6, 'negative DC');
  const tiny = sat4x(new Float64Array(400).fill(1e-7), p);
  close(tiny[399]! / 1e-7, 0.1 * 50, 1e-3, 'small-signal gain');
});

test('runWavenetBlocks gives the same output for any block size', () => {
  const model = parseNam(readFileSync(new URL('./fixtures/clo/ref_input.nam', import.meta.url), 'utf8'));
  const x = noise(6000, 0.3);
  const whole = runWavenetBlocks(x, model, 1 << 18);
  const blocks = runWavenetBlocks(x, model, 1500);
  assert.deepEqual(blocks, whole);
});

test('parseNam reads sample_rate and refuses a nonsense one', () => {
  const text = readFileSync(new URL('./fixtures/clo/ref_input.nam', import.meta.url), 'utf8');
  assert.equal(parseNam(text).sampleRate, 48000);
  const json = JSON.parse(text);
  assert.equal(parseNam(JSON.stringify({ ...json, sample_rate: 44100 })).sampleRate, 44100);
  const { sample_rate: _drop, ...noRate } = json;
  assert.equal(parseNam(JSON.stringify(noRate)).sampleRate, 48000);
  assert.throws(() => parseNam(JSON.stringify({ ...json, sample_rate: 'fast' })), /sample_rate/);
});

test('startClone recovers a clone chain it is fitted to', { timeout: 120_000 }, () => {
  const fs = 16000;
  const x = sectionsDi(fs);
  const sat = { apos: 0.09, aneg: 0.08, kp: 600, kn: 500 };
  const h1 = Float64Array.from([0.02, 0.01, 0.005]);
  const h2 = Float64Array.from({ length: 64 }, (_, i) => Math.exp(-i / 6) * (i % 3 === 2 ? -0.5 : 1));
  const target = convolve(iirRun(sat4x(convolve(x, h1), sat), hpf40(fs)), h2);
  const r = startClone(x, target, fs);
  assert.ok(r.latency < 16, `latency ${r.latency}`);
  assert.equal(r.h1.length, 128);
  assert.equal(r.h2.length, 2048);
  // A from the peaks of the rising sine: the chain's ceiling at 300 Hz
  assert.ok(r.sat.apos > 0 && r.sat.aneg > 0 && r.sat.kp > 0 && r.sat.kn > 0);
  // the fitted chain plays the loud noise section at the target's level (IR 2 carries x 4)
  const seg = (s: Float64Array) => s.subarray(52 * fs, 68 * fs);
  const rms = (s: Float64Array) => Math.sqrt(s.reduce((t, v) => t + v * v, 0) / s.length);
  const fitted = convolve(iirRun(sat4x(convolve(x, r.h1), r.sat), r.iir2), r.h2);
  close(db(rms(seg(fitted)) / 4), db(rms(seg(target))), 1, 'level');
  const arrays = startCloneArrays(r, fs);
  assert.equal(arrays.arrayA.length, 128);
  assert.equal(arrays.arrayB.length, 2048);
  assert.ok(Array.from(arrays.arrayB).every(Number.isFinite));
});
