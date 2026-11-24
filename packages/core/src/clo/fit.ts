/**
 * Multi-level Wiener-Hammerstein fit of the pedal's clone engine (pre-filter A -> asymmetric
 * exponential saturator -> post-filter B) to a capture's responses at several input levels.
 * Ported from SonicMaster (MIT; clo_dsp.dart at 931a68f).
 */
import { BINS, Fft, firify, NFFT, welchPairs } from './fft.ts';
import { deconv, logsmooth, minphaseFir, minphaseMag } from './filters.ts';

export const ARRAY_A_LEN = 128;
export const ARRAY_B_LEN = 2048;
export const SRC_RATE = 48000;
/** Input attenuations the capture is probed at; the curvature is only identifiable across levels. */
export const FIT_LEVELS = [0.1, 0.03, 0.01, 0.003] as const;
/** Hard-driven level, used only to initialise the pre-filter. */
export const LOUD_LEVEL = 1.0;
export const FIT_START = 300000;
export const FIT_END = 1500000;
export const RUN_LEN = 1600000;
const MAX_BULK_LAG = 8192;
const MIN_BULK_LAG = 256;
const LAG_WIN = 1 << 18;
const LAG_FFT_SIZE = 1 << 19;

export interface Gains {
  readonly posmax: number;
  readonly negmax: number;
  readonly posRate: number;
  readonly negRate: number;
}

/** The pedal's asymmetric exponential saturator. */
export function nlFwd(v: Float64Array, g: Gains): Float64Array {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    out[i] = x > 0 ? g.posmax * (1 - Math.exp(Math.max(-g.posRate * x, -60))) : -g.negmax * (1 - Math.exp(Math.min(g.negRate * x, 60)));
  }
  return out;
}

/** Fits the saturator to per-level (pre-drive -> target) pairs; each side on a log grid of rates. */
export function fitNl(vs: readonly Float64Array[], ts: readonly Float64Array[]): Gains {
  const stride = 16;
  const vq = vs[vs.length - 1]!;
  const mags: number[] = [];
  for (let i = 0; i < vq.length; i += stride) {
    const a = Math.abs(vq[i]!);
    if (a > 1e-8) mags.push(a);
  }
  mags.sort((a, b) => a - b);
  const idx = Math.trunc((mags.length * 9) / 10);
  const p90 = idx < mags.length ? mags[idx]! : 1e-3;
  const rMax = Math.max(1 / Math.max(p90, 1e-9), 1);
  const rMin = 0.5;

  const fitSide = (sign: number): [number, number] => {
    const xsl: Float64Array[] = [];
    const ysl: Float64Array[] = [];
    const wl: number[] = [];
    for (let li = 0; li < vs.length; li++) {
      const v = vs[li]!;
      const t = ts[li]!;
      const lim = Math.min(v.length, t.length);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < lim; i += stride) {
        const x = v[i]! * sign;
        if (x > 1e-8) {
          xs.push(x);
          ys.push(t[i]! * sign);
        }
      }
      let sumsq = 0;
      for (const yv of ys) sumsq += yv * yv;
      const rms = Math.sqrt(sumsq / Math.max(ys.length, 1));
      xsl.push(Float64Array.from(xs));
      ysl.push(Float64Array.from(ys));
      wl.push(1 / Math.max(rms, 1e-9));
    }
    let bestResid = Infinity;
    let bestC = 1;
    let bestR = 1;
    const n = 80;
    for (let kk = 0; kk < n; kk++) {
      const r = rMin * (rMax / rMin) ** (kk / (n - 1));
      let num = 0;
      let den = 0;
      for (let li = 0; li < xsl.length; li++) {
        const xs = xsl[li]!,
          ys = ysl[li]!,
          w = wl[li]!;
        for (let s = 0; s < xs.length; s++) {
          const e = 1 - Math.exp(Math.max(-r * xs[s]!, -60));
          num += w * ys[s]! * e;
          den += w * e * e;
        }
      }
      if (den < 1e-12) continue;
      const c = num / den;
      if (c <= 0) continue;
      let resid = 0;
      for (let li = 0; li < xsl.length; li++) {
        const xs = xsl[li]!,
          ys = ysl[li]!,
          w = wl[li]!;
        let se = 0;
        for (let s = 0; s < xs.length; s++) {
          const d = ys[s]! - c * (1 - Math.exp(Math.max(-r * xs[s]!, -60)));
          se += d * d;
        }
        resid += (w * se) / Math.max(xs.length, 1);
      }
      if (resid < bestResid) {
        bestResid = resid;
        bestC = c;
        bestR = r;
      }
    }
    return [bestC, bestR];
  };
  const [posmax, posRate] = fitSide(1);
  const [negmax, negRate] = fitSide(-1);
  return { posmax, negmax, posRate, negRate };
}

/** Direct FIR convolution. */
export function convFir(x: Float64Array, h: Float64Array): Float64Array {
  const y = new Float64Array(x.length);
  for (let k = 0; k < h.length; k++) {
    const hk = h[k]!;
    if (hk === 0) continue;
    for (let t = k; t < x.length; t++) y[t]! += hk * x[t - k]!;
  }
  return y;
}

/**
 * The capture's own DI -> response latency (0..8192 samples; 0 below 256), from normalised
 * cross-correlations of every fit level summed so each level votes equally.
 */
export function bulkLag(di: Float64Array, resps: readonly Float64Array[]): number {
  if (resps.length === 0) return 0;
  let span = di.length;
  for (const r of resps) span = Math.min(span, r.length);
  if (span < LAG_WIN + MAX_BULK_LAG) return 0;
  let start = 0;
  let loudest = -1;
  for (let s = 0; s + LAG_WIN + MAX_BULK_LAG <= span; s += LAG_WIN / 2) {
    let e = 0;
    for (let i = 0; i < LAG_WIN; i++) e += resps[0]![s + i]! ** 2;
    if (e > loudest) {
      loudest = e;
      start = s;
    }
  }
  const lagFft = new Fft(LAG_FFT_SIZE);
  const diRe = new Float64Array(LAG_FFT_SIZE);
  const diIm = new Float64Array(LAG_FFT_SIZE);
  diRe.set(di.subarray(start, start + LAG_WIN));
  lagFft.transform(diRe, diIm, false);
  const votes = new Float64Array(MAX_BULK_LAG + 1);
  for (const resp of resps) {
    const re = new Float64Array(LAG_FFT_SIZE);
    const im = new Float64Array(LAG_FFT_SIZE);
    re.set(resp.subarray(start, start + LAG_WIN));
    lagFft.transform(re, im, false);
    for (let i = 0; i < LAG_FFT_SIZE; i++) {
      const rr = re[i]!,
        ri = im[i]!;
      re[i] = rr * diRe[i]! + ri * diIm[i]!;
      im[i] = ri * diRe[i]! - rr * diIm[i]!;
    }
    lagFft.transform(re, im, true);
    let peak = 0;
    for (let l = 0; l <= MAX_BULK_LAG; l++) peak = Math.max(peak, Math.abs(re[l]!));
    if (peak <= 0) continue;
    for (let l = 0; l <= MAX_BULK_LAG; l++) votes[l]! += Math.abs(re[l]!) / peak;
  }
  let lag = 0;
  for (let l = 1; l <= MAX_BULK_LAG; l++) if (votes[l]! > votes[lag]!) lag = l;
  return lag < MIN_BULK_LAG ? 0 : lag;
}

export interface FitResult {
  /** 128 taps at 48 kHz. */
  readonly a48: Float64Array;
  /** 2048 taps at 48 kHz, minimum phase. */
  readonly b48: Float64Array;
  readonly gains: Gains;
  readonly lag: number;
}

/** The multi-level fit from (level, response) pairs over [0, RUN_LEN) at 48 kHz. */
export function fitWhMultilevel(di48: Float64Array, responses: ReadonlyMap<number, Float64Array>): FitResult {
  const respOf = (level: number): Float64Array => {
    const r = responses.get(level);
    if (!r) throw new Error(`probe level missing: ${level}`);
    return r;
  };
  const seg = (x: Float64Array) => x.subarray(FIT_START, Math.min(FIT_END, x.length));
  const scaledSeg = (x: Float64Array, k: number) => Float64Array.from(seg(x), (v) => v * k);
  const quiet = FIT_LEVELS[FIT_LEVELS.length - 1]!;
  const lag = bulkLag(di48, FIT_LEVELS.map(respOf));
  const segResp = (x: Float64Array) => x.subarray(FIT_START + lag, Math.min(FIT_END + lag, x.length));
  const xsFit = FIT_LEVELS.map((k) => scaledSeg(di48, k));
  const ysFit = FIT_LEVELS.map((k) => segResp(respOf(k)));

  // arrayA init: min-phase of the smoothed quiet/loud ratio, unity at about 1 kHz
  const hQ = welchPairs([[scaledSeg(di48, quiet), segResp(respOf(quiet))]], 1e-5);
  const hL = welchPairs([[scaledSeg(di48, LOUD_LEVEL), segResp(respOf(LOUD_LEVEL))]], 1e-5);
  const ratioRaw = Float64Array.from({ length: BINS }, (_, i) => {
    const nq = Math.sqrt(hQ.re[i]! ** 2 + hQ.im[i]! ** 2);
    const nl = Math.sqrt(hL.re[i]! ** 2 + hL.im[i]! ** 2);
    return nq / Math.max(nl, 1e-9);
  });
  const ratio = logsmooth(ratioRaw);
  const norm = Math.max(ratio[Math.trunc((1000 * NFFT) / SRC_RATE)]!, 1e-9);
  for (let i = 0; i < BINS; i++) ratio[i] = ratio[i]! / norm;
  const a48 = minphaseMag(ratio, ARRAY_A_LEN);

  // arrayB init: the hard-driven transfer; then coordinate descent
  let hB = hL;
  let b48 = firify(hB, ARRAY_B_LEN);
  const vs = xsFit.map((x) => convFir(x, a48));
  let gains: Gains = { posmax: 1, negmax: 1, posRate: 1, negRate: 1 };
  for (let round = 0; round < 3; round++) {
    const ts = ysFit.map((y) => deconv(y, b48, 3e-3));
    gains = fitNl(vs, ts);
    const us = vs.map((v) => nlFwd(v, gains));
    hB = welchPairs(
      us.map((u, i) => [u, ysFit[i]!] as const),
      1e-5,
    );
    b48 = firify(hB, ARRAY_B_LEN);
  }
  return { a48, b48: minphaseFir(hB, ARRAY_B_LEN), gains, lag };
}
