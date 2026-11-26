/**
 * The DSP helpers of the official Valeton / Sonicake editor's NAM -> clone fit (HTKPA::startClone in
 * its HTUSBTools library), as reconstructed by waveod's tools/clonefit/clonefit.cpp.
 *
 * Ported to TypeScript from waveod (github.com/zxmarcos/waveod, MIT,
 * Copyright (c) 2026 Marcos Medeiros; see NOTICE). Arithmetic is float64 where the original is
 * float32, except where float32 rounding is part of the result (the IIR coefficients).
 */
import { Fft } from './fft.ts';

export const FLT_EPS = 1.1920928955078125e-7;
const FMAX = 3.4028234663852886e38;
const f32 = Math.fround;

export interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** IIR 2 of every capture: a 40 Hz Butterworth high-pass at `fs`, in the editor's float32 math. */
export function hpf40(fs: number): Biquad {
  const s = f32(fs);
  const f2 = f32(s * s);
  const den = f32(f32(f32(f32(177.715805) * s) + f2) + f32(15791.4521));
  const b0 = f32(f32(f2 + f32(-9.763315e-25)) / den);
  return {
    b0,
    b1: f32(-f32(f32(1.95266306e-24) + f32(f2 + f2)) / den),
    b2: b0,
    a1: f32(-f32(f32(-31582.904296875) + f32(f2 + f2)) / den),
    a2: f32(f32(f32(f32(f32(-177.71580505) * s) + f2) + f32(15791.4521)) / den),
  };
}

/** Direct form II biquad from rest. */
export function iirRun(x: Float64Array, q: Biquad): Float64Array {
  const out = new Float64Array(x.length);
  let w1 = 0;
  let w2 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = x[i]! - q.a1 * w1 - q.a2 * w2;
    out[i] = q.b0 * w + q.b1 * w1 + q.b2 * w2;
    w2 = w1;
    w1 = w;
  }
  return out;
}

const fftCache = new Map<number, Fft>();
const fftOf = (n: number): Fft => {
  let f = fftCache.get(n);
  if (!f) {
    f = new Fft(n);
    fftCache.set(n, f);
  }
  return f;
};

/**
 * Complex DFT of any size (unnormalized; inverse uses e^{+i}); only the first `bins` outputs.
 * ponytail: O(n * bins) for sizes that are not powers of two (254, 510, 4410, 4800 here); Bluestein if larger ones appear.
 */
export function dft(re: Float64Array, im: Float64Array, inverse: boolean, bins = re.length): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  if ((n & (n - 1)) === 0) {
    const r = re.slice();
    const i = im.slice();
    fftOf(n).transform(r, i, inverse);
    return { re: r.subarray(0, bins), im: i.subarray(0, bins) };
  }
  const cos = Float64Array.from({ length: n }, (_, k) => Math.cos((2 * Math.PI * k) / n));
  const sin = Float64Array.from({ length: n }, (_, k) => (inverse ? 1 : -1) * Math.sin((2 * Math.PI * k) / n));
  const outRe = new Float64Array(bins);
  const outIm = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0, idx = 0; t < n; t++, idx = (idx + k) % n) {
      const c = cos[idx]!;
      const s = sin[idx]!;
      sr += re[t]! * c - im[t]! * s;
      si += re[t]! * s + im[t]! * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

/** Linear convolution from rest, as long as `x` (FFT overlap-add). */
export function convolve(x: Float64Array, h: Float64Array): Float64Array {
  let n = 8192;
  while (n < 2 * h.length) n *= 2;
  const block = n - h.length + 1;
  const fft = fftOf(n);
  const hRe = new Float64Array(n);
  const hIm = new Float64Array(n);
  hRe.set(h);
  fft.transform(hRe, hIm, false);
  const y = new Float64Array(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let at = 0; at < x.length; at += block) {
    re.fill(0);
    im.fill(0);
    re.set(x.subarray(at, Math.min(at + block, x.length)));
    fft.transform(re, im, false);
    for (let k = 0; k < n; k++) {
      const a = re[k]!;
      const b = im[k]!;
      re[k] = a * hRe[k]! - b * hIm[k]!;
      im[k] = a * hIm[k]! + b * hRe[k]!;
    }
    fft.transform(re, im, true);
    const end = Math.min(n, x.length - at);
    for (let i = 0; i < end; i++) y[at + i]! += re[i]! / n;
  }
  return y;
}

export interface Saturator {
  readonly apos: number;
  readonly aneg: number;
  readonly kp: number;
  readonly kn: number;
}

/** A(1 - e^(-k x)) per polarity. */
export const saturate = (v: number, p: Saturator): number => (v > 0 ? (1 - Math.exp(-p.kp * v)) * p.apos : (1 - Math.exp(p.kn * v)) * -p.aneg);

const UP7 = [0.045728147, 0.332501113, 0.663202047, 0.933855832, 0.168087542, 0.504485726, 0.803780854];
const UP5 = [0.054230779, 0.39879697, 0.86291784, 0.199699581, 0.621096849];
const DN6 = [0.054217525, 0.383087337, 0.748720944, 0.196797967, 0.57313633, 0.914293706];
const DN4 = [0.07076595, 0.51316756, 0.257853091, 0.817317367];

/** The clone's saturator at 4x through the pedal's half-band all-pass resamplers, from rest. */
export function sat4x(x: Float64Array, p: Saturator): Float64Array {
  const u7 = new Float64Array(7);
  const u5 = new Float64Array(5);
  const d6 = new Float64Array(6);
  const d4 = new Float64Array(4);
  const ap = (a: number, s: Float64Array, k: number, v: number): number => {
    const y = a * v + s[k]!;
    s[k] = v - a * y;
    return y;
  };
  const chain = (coefs: readonly number[], s: Float64Array, from: number, to: number, v: number): number => {
    let y = v;
    for (let k = from; k < to; k++) y = ap(coefs[k]!, s, k, y);
    return y;
  };
  const out = new Float64Array(x.length);
  const q = new Float64Array(4);
  let z6 = 0;
  let z4 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const two = [chain(UP7, u7, 0, 4, v), chain(UP7, u7, 4, 7, v)];
    for (let j = 0; j < 2; j++) {
      q[2 * j] = chain(UP5, u5, 0, 3, two[j]!);
      q[2 * j + 1] = chain(UP5, u5, 3, 5, two[j]!);
    }
    for (let j = 0; j < 4; j++) q[j] = saturate(q[j]!, p);
    const o2 = [0, 0];
    for (let j = 0; j < 2; j++) {
      const c = chain(DN4, d4, 0, 2, q[2 * j]!);
      const e = chain(DN4, d4, 2, 4, q[2 * j + 1]!);
      o2[j] = (c + z4) * 0.5;
      z4 = e;
    }
    const c = chain(DN6, d6, 0, 3, o2[0]!);
    const e = chain(DN6, d6, 3, 6, o2[1]!);
    out[i] = (c + z6) * 0.5;
    z6 = e;
  }
  return out;
}

/** MATLAB smoothdata(x, 'gaussian', w): sigma = w / 5, truncated and renormalised at the edges. */
export function smoothdata(x: Float64Array, w: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (w < 1) return out;
  const a = 5 / w;
  const c = Math.ceil(w * 0.5);
  const g = Float64Array.from({ length: w }, (_, i) => Math.exp(-0.5 * ((i + 1 - c) * a) ** 2));
  const sum = g.reduce((s, v) => s + v, 0);
  const len = w | 1;
  const k = new Float64Array(len);
  for (let j = 0; j < w; j++) k[j] = g[w - 1 - j]! * (1e6 / sum);
  const h = Math.ceil(len * 0.5) - 1;
  for (let i = 0; i < n; i++) {
    if (i >= h && i < n - h) {
      let acc = 0;
      for (let j = -h; j <= h; j++) acc += x[i + j]! * k[j + h]!;
      out[i] = acc * 1e-6;
    } else {
      const lo = -Math.min(i, h);
      const hi = i < n - h ? h : n - 1 - i;
      let num = 0;
      let den = 0;
      for (let j = lo; j <= hi; j++) {
        num += x[i + j]! * k[j + h]!;
        den += k[j + h]!;
      }
      out[i] = num / den;
    }
  }
  return out;
}

/** Linear interpolation on ascending `x`, extrapolated to the right; FLT_MAX left of x[0]. */
export function interp1(x: Float64Array, y: Float64Array, xq: Float64Array): Float64Array {
  const nx = x.length;
  const out = new Float64Array(xq.length).fill(FMAX);
  if (nx < 2) return out;
  const sl = new Float64Array(nx);
  const ic = new Float64Array(nx);
  for (let i = 0; i + 1 < nx; i++) {
    sl[i] = (y[i + 1]! - y[i]!) / (x[i + 1]! - x[i]!);
    ic[i] = y[i]! - x[i]! * sl[i]!;
  }
  sl[nx - 1] = sl[nx - 2]!;
  ic[nx - 1] = ic[nx - 2]!;
  for (let q = 0; q < xq.length; q++) {
    // upper_bound: the first x[i] > xq
    let lo = 0;
    let hi = nx;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= xq[q]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) continue;
    out[q] = xq[q]! * sl[lo - 1]! + ic[lo - 1]!;
  }
  return out;
}

const melOf = (hz: number) => Math.log10(hz / 700 + 1) * 2595;
const hzOf = (mel: number) => (10 ** (mel / 2595) - 1) * 700;

/** n evenly spaced points from a to b. */
export function linspace(a: number, b: number, n: number): Float64Array {
  const v = Float64Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  v[n - 1] = b;
  return v;
}

export interface Curve {
  readonly mag: Float64Array;
  readonly freq: Float64Array;
}

/** Smooths a magnitude in dB on a mel-warped axis and resamples it to m points of a linear axis. */
export function smoothFreq(mag: Float64Array, f: Float64Array, m: number): Curve {
  const n = mag.length;
  const lo = f[0]!;
  const hi = f[n - 1]!;
  const melN = linspace(melOf(lo), melOf(hi), n);
  const hzN = melN.map(hzOf);
  hzN[0] = lo;
  hzN[n - 1] = hi;
  const melM = linspace(melOf(lo), melOf(hi), m);
  const hzM = melM.map(hzOf);
  hzM[0] = lo;
  hzM[m - 1] = hi;
  const freq = linspace(lo, hi, m);
  const db = mag.map((v) => 20 * Math.log10(v));
  const t2 = interp1(f, smoothdata(db, Math.trunc(n * 0.002)), hzN);
  const t3 = smoothdata(t2, Math.trunc(n / m) * 2);
  const t4 = n !== m ? interp1(melN, t3, melM) : t3;
  return { mag: interp1(hzM, t4, freq).map((v) => 10 ** (v * 0.05)), freq };
}

/** Real-cepstrum minimum phase from a one-sided magnitude: L taps, DC removed, the full energy kept. */
export function minPhase(mag: Float64Array, taps: number): Float64Array {
  const p = mag.length;
  const n = 2 * p - 2;
  const spec = new Float64Array(n);
  spec.set(mag);
  for (let j = 0; j < p - 2; j++) spec[p + j] = mag[p - 2 - j]!;
  const floor = spec.reduce((m, v) => Math.max(m, Math.abs(v)), 0) * 1e-5;
  const lg = spec.map((v) => Math.log((Math.abs(v) < floor ? floor : v) + FLT_EPS));
  const c = dft(lg, new Float64Array(n), true);
  const cfRe = new Float64Array(n);
  const cfIm = new Float64Array(n);
  cfRe[0] = c.re[0]! / n;
  cfIm[0] = c.im[0]! / n;
  for (let k = 1; k < n / 2; k++) {
    cfRe[k] = (c.re[k]! + c.re[n - k]!) / n;
    cfIm[k] = (c.im[k]! - c.im[n - k]!) / n;
  }
  cfRe[n / 2] = c.re[n / 2]! / n;
  cfIm[n / 2] = -c.im[n / 2]! / n;
  const y = dft(cfRe, cfIm, false);
  const zRe = y.re.map((r, k) => Math.exp(r) * Math.cos(y.im[k]!));
  const zIm = y.re.map((r, k) => Math.exp(r) * Math.sin(y.im[k]!));
  const hz = dft(zRe, zIm, true).re.map((v) => v / n);
  const energy = hz.reduce((s, v) => s + v * v, 0);
  const h = new Float64Array(taps);
  h.set(hz.subarray(0, Math.min(taps, n)));
  const mean = h.reduce((s, v) => s + v, 0) / taps;
  const centred = h.map((v) => v - mean);
  const e2 = centred.reduce((s, v) => s + v * v, 0);
  const g = Math.sqrt(energy) / Math.sqrt(e2);
  return centred.map((v) => v * g);
}

export const TF_NFFT = 2048;
export const TF_BINS = TF_NFFT / 2 + 1;

/**
 * Welch |Pyx| / Pxx: Hamming window of `win` samples, 50 % overlap, segments x 1000 with their
 * mean removed and wrapped onto TF_NFFT points (MATLAB's tfestimate with nfft < window).
 */
export function tfestimate(x: Float64Array, y: Float64Array, len: number, win: number, fs: number): Curve {
  const w = Float64Array.from({ length: win }, (_, i) => 0.54 - 0.46 * Math.cos((i * 6.2831855) / (win - 1)));
  const pxx = new Float64Array(TF_BINS);
  const sre = new Float64Array(TF_BINS);
  const sim = new Float64Array(TF_BINS);
  const xr = new Float64Array(TF_NFFT);
  const xi = new Float64Array(TF_NFFT);
  const yr = new Float64Array(TF_NFFT);
  const yi = new Float64Array(TF_NFFT);
  const fft = fftOf(TF_NFFT);
  const hop = win - Math.trunc(win * 0.5);
  let pos = 0;
  let last = false;
  for (;;) {
    if (pos >= len - win) {
      last = true;
      pos = len - win;
    }
    let mx = 0;
    let my = 0;
    for (let i = 0; i < win; i++) {
      mx += x[pos + i]! * 1000;
      my += y[pos + i]! * 1000;
    }
    mx /= win;
    my /= win;
    xr.fill(0);
    xi.fill(0);
    yr.fill(0);
    yi.fill(0);
    for (let i = 0; i < win; i++) {
      xr[i % TF_NFFT]! += (x[pos + i]! * 1000 - mx) * w[i]!;
      yr[i % TF_NFFT]! += (y[pos + i]! * 1000 - my) * w[i]!;
    }
    fft.transform(xr, xi, false);
    fft.transform(yr, yi, false);
    for (let k = 0; k < TF_BINS; k++) {
      pxx[k]! += xr[k]! ** 2 + xi[k]! ** 2;
      sre[k]! += xr[k]! * yr[k]! + xi[k]! * yi[k]!;
      sim[k]! += xr[k]! * yi[k]! - xi[k]! * yr[k]!;
    }
    pos += hop;
    if (pos >= len || last) break;
  }
  return {
    mag: Float64Array.from({ length: TF_BINS }, (_, k) => Math.sqrt(sre[k]! ** 2 + sim[k]! ** 2) / (pxx[k]! + FLT_EPS)),
    freq: Float64Array.from({ length: TF_BINS }, (_, k) => (k / TF_NFFT) * fs),
  };
}
