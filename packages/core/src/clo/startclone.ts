/**
 * .nam -> a Matribox II Pro clone capture the way the official Valeton / Sonicake editor makes it
 * (HTKPA::startClone in its HTUSBTools library): the model runs once over the 70 s reference DI at
 * its own rate, then a Wiener-Hammerstein fit of the clone engine (IIR 1 = identity -> IR 1, 128
 * taps -> 4x saturator A(1 - e^(-k x)) -> IIR 2, a 40 Hz high-pass -> IR 2, 2048 taps) to that
 * DI / output pair, and both IRs resampled to 44.1 kHz.
 *
 * Ported to TypeScript from waveod's tools/clonefit/clonefit.cpp and docs/clone_fit.md
 * (github.com/zxmarcos/waveod, MIT, Copyright (c) 2026 Marcos Medeiros; see NOTICE), with the
 * model run by our WaveNet (wavenet.ts) instead of NeuralAmpModelerCore and the IRs resampled by
 * our r8brain port (the editor's resampler).
 */
import { r8bResample } from '../matribox/r8b.ts';
import { type CloArrays, DEVICE_RATE } from './generate.ts';
import { parseNam, type Wavenet } from './nam.ts';
import { resample } from './resample.ts';
import {
  type Biquad,
  convolve,
  type Curve,
  dft,
  FLT_EPS,
  hpf40,
  iirRun,
  interp1,
  linspace,
  minPhase,
  type Saturator,
  sat4x,
  saturate,
  smoothdata,
  smoothFreq,
  TF_BINS,
  tfestimate,
} from './startclone-dsp.ts';
import { runWavenet } from './wavenet.ts';

const DI_RATE = 44100;
/** The editor keeps the model's output x 0.31 at 16 bits. */
export const MODEL_OUTPUT_GAIN = 0.31;
const IR1_TAPS = 128;
const IR2_TAPS = 2048;
const f32 = Math.fround;

/** The cabinet-like FIR the loud sweep goes through for the starting IR 2 estimate, per rate. */
const FIR44 = [
  2.36821008, 3.57428002, 3.09571004, -0.392399013, -3.15094995, -3.83070993, -2.21564007, -0.882995009, -0.212944001, -0.19314, 0.223961994, 0.404027998, 0.378322005, 0.0894064009, 0.193555996,
  0.283547014, 0.343944997, 0.0529306009, -0.0379724987, -0.0676138997, 0.0733582973, -0.0264890008, -0.0229163002, 0.0236044005, 0.085258998, -0.00927979033, 0.0438198, 0.0233258009, 0.134894997,
  0.00628683995, -0.0259121992, -0.0195527002, 0.0853129998, -0.0184777994, -0.0766421035, -0.0785638988, 0.0335091017, 0.0272959992, -0.0993169025, -0.0953475013, 0.0532824993, 0.0342740007,
  -0.0936421007, -0.0669772997, -0.0113530997, 0.0399198011, -0.0771979019, -0.0979806036, 0.00203220011, 0.0430492982,
];
const FIR48 = [
  2.36980891, 3.53219938, 3.38600636, 0.571152806, -2.49451208, -3.85038185, -3.16384506, -1.51175368, -0.581693113, -0.176165596, -0.153762206, 0.266270608, 0.405162007, 0.38954851, 0.113782898,
  0.153672799, 0.260469586, 0.356198996, 0.202282995, -0.0178810991, -0.0592595004, -0.0305259991, 0.0732804015, -0.0387939997, -0.0205725003, 0.0209499002, 0.0891723037, -0.000669899979,
  0.0329804011, 0.0190768, 0.095199503, 0.0939730033, -0.0269184001, -0.0281860009, 0.0035335999, 0.0851882026, -0.0284807999, -0.0766185001, -0.082170397, 0.0129757002, 0.0508528985, -0.0622742996,
  -0.122342698, -0.0220810995, 0.0803612992, -0.0201430004, -0.0981329009, -0.0581544004, -0.00325089996, 0.0392660014,
];
const FIR96 = [
  2.36980891, 3.1448822, 3.53219938, 3.68479872, 3.38600659, 2.29713893, 0.571152806, -1.17574263, -2.49451208, -3.36989093, -3.85038209, -3.79510856, -3.16384506, -2.27035475, -1.5117538,
  -0.987195015, -0.581693172, -0.282492012, -0.176165596, -0.201950803, -0.153762206, 0.0479568988, 0.266270608, 0.374002993, 0.405162007, 0.421350509, 0.38954851, 0.256981611, 0.113782898,
  0.0814799964, 0.153672799, 0.228178203, 0.260469586, 0.303641886, 0.356198996, 0.332263112, 0.202282995, 0.0537629016, -0.0178810991, -0.0349936001, -0.0592595004, -0.0757692009, -0.0305259991,
  0.0492307991, 0.0732804015, 0.0194604993, -0.0387939997, -0.0440240018, -0.0205725003, -0.00432030018,
];

const unitIr = (n: number) => {
  const h = new Float64Array(n);
  h[0] = 1;
  return h;
};

/** IRs and their spectra as the fit refines them. */
interface Shape {
  readonly h1: Float64Array;
  readonly h2: Float64Array;
  readonly H1: Float64Array;
  readonly H2: Float64Array;
  readonly freq: Float64Array;
}

export interface StartCloneResult {
  readonly sat: Saturator;
  readonly iir2: Biquad;
  /** IR 1 (128 taps) and IR 2 (2048 taps) at the fit rate. */
  readonly h1: Float64Array;
  readonly h2: Float64Array;
  /** Samples from the DI's click at 6 s to the output's onset. */
  readonly latency: number;
}

class Fit {
  readonly fs: number;
  readonly win: number;
  readonly iir2: Biquad;
  readonly hz512: Float64Array;
  readonly A0 = new Float64Array(TF_BINS).fill(1);
  readonly Bw: Float64Array;
  sat: Saturator = { apos: 1, aneg: 1, kp: 1, kn: 1 };

  constructor(fs: number) {
    this.fs = fs;
    this.win = Math.trunc(f32(fs) * 0.125 + 0.5);
    this.iir2 = hpf40(fs);
    // 512 mel-spaced frequencies, 80 Hz .. 10 kHz (the error metric)
    this.hz512 = Float64Array.from({ length: 512 }, (_, i) => (i === 0 ? 80 : i === 511 ? 10000 : (10 ** ((121.95607 + 5.77547026 * i) / 2595) - 1) * 700));
    // per-bin weights of the correction: 1 below 80 Hz, down to 0.5 at the top
    this.Bw = new Float64Array(TF_BINS).fill(1);
    const k0 = Math.floor((2 / fs) * 80 * TF_BINS);
    const cnt = TF_BINS - k0;
    for (let j = 1; j <= cnt; j++) this.Bw[k0 - 1 + j] = j === cnt ? 0.5 : 1 - (0.5 * j) / cnt;
  }

  tf(x: Float64Array, y: Float64Array): Curve {
    return tfestimate(x, y, x.length, this.win, this.fs);
  }

  /** The clone engine without IR 2: (IIR 1 = identity) -> IR 1 -> saturator -> IIR 2. */
  model(x: Float64Array, h1: Float64Array): Float64Array {
    return iirRun(sat4x(convolve(x, h1), this.sat), this.iir2);
  }

  /** iterAmpCoeff: moves spectral shape between IR 1 and IR 2 so the whole chain follows the target. */
  iterAmp(x: Float64Array, target: Float64Array, iters: number, start: Shape): Shape {
    const n = TF_BINS;
    let A: Float64Array = this.A0.slice();
    let bestA = A;
    let { h1, h2, H1, H2, freq }: Shape = start;
    let best = { h1, h2, H1, H2 };
    let bestErr = 100;
    let mu = 1;
    const nlf = Math.floor((2 / this.fs) * 60 * n);
    for (let it = 0; it < iters; it++) {
      const step = A.map((a, k) => Math.max(0.2, Math.min(5, a ** (this.Bw[k]! * mu))));
      const c = smoothFreq(step, freq, n);
      const c2 = smoothFreq(c.mag, c.freq, n);
      A = c2.mag;
      freq = c2.freq;
      H2 = H2.map((v, k) => v * A[k]!);
      const h1Spec = H1.map((v, k) => v / A[k]!);
      mu *= 0.9;
      if (nlf >= 2) {
        h1Spec[0] = Math.sqrt(Math.sqrt(h1Spec[0]! * h1Spec[1]!) * h1Spec[0]!);
        for (let i = 1; i < nlf; i++) h1Spec[i] = Math.sqrt(Math.sqrt(h1Spec[i - 1]! * h1Spec[i + 1]!) * h1Spec[i]!);
      }
      H1 = h1Spec;
      h1 = minPhase(smoothFreq(H1, freq, IR1_TAPS).mag, IR1_TAPS);
      const m = this.model(x, h1);
      const e = this.tf(m, target);
      const h2Now = H2;
      const ratio = e.mag.map((v, k) => (v * 1e6) / (h2Now[k]! * 1e6 + FLT_EPS));
      A = smoothFreq(ratio, e.freq, n).mag;
      h2 = minPhase(e.mag, IR2_TAPS);
      const res = this.tf(convolve(m, h2), target);
      freq = res.freq;
      const fq = interp1(freq, res.mag, this.hz512);
      const err = fq.reduce((s, v) => s + Math.abs(Math.log(v + FLT_EPS)), 0) / 512;
      if (err < bestErr) {
        bestErr = err;
        bestA = A;
        best = { h1, h2, H1, H2 };
      } else if (err > 1.2 * bestErr) {
        A = bestA;
        ({ h1, h2, H1, H2 } = best);
        mu *= 0.5;
      }
    }
    return { ...best, freq };
  }

  /** The output's mean and linear trend removed, in the editor's float32 sums. */
  static detrend(y: Float64Array): Float64Array {
    const n = y.length;
    let s = 0;
    for (let i = 0; i < n; i++) s = f32(s + y[i]!);
    const mean = f32(s / n);
    const z = y.map((v) => f32(v - mean));
    let st = 0;
    let sy = 0;
    let stt = 0;
    let sty = 0;
    for (let i = 0; i < n; i++) {
      const t = f32(i + 1);
      st = f32(st + t);
      sy = f32(sy + z[i]!);
      stt = f32(stt + f32(t * t));
      sty = f32(sty + f32(z[i]! * t));
    }
    const nf = f32(n);
    const slope = f32(f32(f32(sty * nf) - f32(sy * st)) / f32(f32(stt * nf) - f32(st * st)));
    const icpt = f32(f32(sy - f32(st * slope)) / nf);
    return z.map((v, i) => f32(v - f32(f32(slope * f32(i + 1)) + icpt)));
  }

  /** The saturator from the rising sine (0-5 s): A from the output's peaks, k from the small-signal slope. */
  fitSaturator(x: Float64Array, yl: Float64Array): Saturator {
    const blk = f32(this.fs * 0.1);
    const nb = Math.floor(Math.trunc(5 * this.fs) / blk);
    const A = new Float64Array(nb);
    const B = new Float64Array(nb);
    const C = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      for (let j = Math.trunc(f32(b * blk)); j < Math.trunc(f32((b + 1) * blk)); j++) {
        A[b] = Math.max(A[b]!, Math.abs(x[j]!));
        B[b] = Math.max(B[b]!, yl[j]!);
        C[b] = Math.min(C[b]!, yl[j]!);
      }
    }
    const apos = B.reduce((m, v) => Math.max(m, v), 0);
    const aneg = C.reduce((m, v) => Math.max(m, -v), 0);
    const X = Float64Array.from({ length: 2 * nb }, (_, i) => (i < nb ? -A[nb - 1 - i]! : A[i - nb]!));
    const Y = Float64Array.from({ length: 2 * nb }, (_, i) => (i < nb ? C[nb - 1 - i]! : B[i - nb]!));
    const np = B.findIndex((v) => v >= apos * 0.5) + 1;
    const nn = C.findIndex((v) => v <= aneg * -0.5) + 1;
    let sp = 0;
    let sa = 0;
    let sn = 0;
    let san = 0;
    for (let b = 0; b < np; b++) {
      sp += A[b]! * B[b]!;
      sa += A[b]! * A[b]!;
    }
    for (let b = 0; b < nn; b++) {
      sn += -C[b]! * A[b]!;
      san += A[b]! * A[b]!;
    }
    let kp = (np ? sp / sa : Number.NaN) / apos;
    let kn = (nn ? sn / san : Number.NaN) / aneg;
    const err = (p: number, q: number) => {
      let e = 0;
      for (let i = 0; i < 2 * nb; i++) e += (Y[i]! - saturate(X[i]!, { apos, aneg, kp: p, kn: q })) ** 2;
      return e;
    };
    // the best of 0.8 .. 1.2 x k for each side (a later multiplier wins a tie)
    const search = (side: (m: number) => number) => {
      let best = Number.POSITIVE_INFINITY;
      let pick = 1;
      [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2].forEach((m, i) => {
        const e = side(m);
        if (i === 0) {
          best = e;
          pick = 0.8;
        } else if (!(best < e)) {
          best = e;
          pick = m;
        }
      });
      return pick;
    };
    kp *= search((m) => err(m * kp, kn));
    kn *= search((m) => err(kp, m * kn));
    return { apos, aneg, kp, kn };
  }

  /** The last correction of IR 2 from the averaged spectra of the model and the output over the music, then its level. */
  finalIr2(x: Float64Array, yl: Float64Array, h1: Float64Array, h2: Float64Array): Float64Array {
    const d = this.model(x, h1);
    const ym = convolve(d, h2);
    const M = Math.ceil(this.fs * 0.1);
    const K = Math.trunc(M * 0.5 + 1);
    const P = Math.trunc(x.length / M);
    const avg = (s: Float64Array) => {
      const a = new Float64Array(M);
      for (let p = 0; p < P; p++) for (let i = 0; i < M; i++) a[i]! += s[p * M + i]!;
      const mean = a.reduce((t, v) => t + v, 0) / M;
      const w = (i: number) => Math.cos((i * 6.2831855) / (M - 1)) * -0.46 + 0.54;
      const spec = dft(
        a.map((v, i) => (v - mean) * w(i)),
        new Float64Array(M),
        false,
        K,
      );
      return spec.re.map((r, k) => Math.hypot(r, spec.im[k]!));
    };
    const F = linspace(0, this.fs * 0.5, K);
    const sM = smoothFreq(avg(ym), F, K).mag;
    const sD = smoothFreq(avg(yl), F, K).mag;
    const clamp = (v: number) => {
      const c = Math.min(v, 10);
      return Number.isNaN(c) ? 0.1 : Math.max(c, 0.1); // NaN -> 0.1, as the editor's c >= 0.1 ? c : 0.1
    };
    const R = smoothdata(
      sD.map((v, k) => clamp((v * 1e6) / (sM[k]! * 1e6 + FLT_EPS))),
      Math.trunc(K * 0.1),
    ).map(clamp);
    const mp = minPhase(smoothFreq(R, F, 256).mag, 256);
    const acc = new Float64Array(IR2_TAPS);
    for (let i = 0; i < IR2_TAPS; i++) for (let j = 0; j < 256 && i + j < IR2_TAPS; j++) acc[i + j]! += mp[j]! * h2[i]!;
    const mean = acc.reduce((s, v) => s + v, 0) / IR2_TAPS;
    const corrected = acc.map((v) => v - mean);
    const d2 = convolve(d, corrected);
    const energy = (s: Float64Array) => s.reduce((t, v) => t + v * v, 0);
    const g = Math.sqrt(energy(yl.subarray(0, x.length))) / Math.sqrt(energy(d2));
    return corrected.map((v) => v * g * 4);
  }

  run(xIn: Float64Array, yIn: Float64Array): StartCloneResult {
    const fs = this.fs;
    const total = Math.trunc(70 * fs + 600);
    const x = new Float64Array(total);
    x.set(xIn.subarray(0, total));
    const yPad = new Float64Array(total);
    yPad.set(yIn.subarray(0, total));
    const y = Fit.detrend(yPad);
    // latency: the first output sample above 0.01 after the click at 6 s
    const i0 = 6 * Math.trunc(fs);
    let lat = 600;
    for (let i = i0; i < i0 + 600; i++) {
      if (Math.abs(y[i]!) > 0.01) {
        lat = i - i0;
        break;
      }
    }
    const yl = y.subarray(lat);
    this.sat = this.fitSaturator(x, yl);
    const sec = (s: number) => s * Math.trunc(fs);
    const span = (a: Float64Array, from: number, seconds: number) => a.subarray(sec(from), sec(from) + Math.trunc(seconds * fs));
    const noper = (s: Float64Array) => iirRun(sat4x(s, this.sat), this.iir2);
    // the model without IRs against the output: quiet noise (6-21 s), loud sweep through a cabinet-like FIR (23-28 s)
    const t1 = this.tf(noper(span(x, 6, 15)), span(yl, 6, 15)).mag;
    const fir = fs === 44100 ? FIR44 : fs === 96000 ? FIR96 : FIR48;
    const loud = this.tf(noper(convolve(span(x, 23, 5), Float64Array.from(fir))), span(yl, 23, 5));
    const n = TF_BINS;
    const t2s = smoothdata(smoothdata(loud.mag, Math.trunc(0.001 * n)), Math.trunc(n * 0.005));
    const m = t1.reduce((a, v) => Math.max(a, v), 0) * 0.001;
    const m2 = m + m;
    const c = (m2 - m) / (m2 * m2);
    const T2 = t2s.map((v) => (v < m2 ? c * v * v + m : v));
    const H = t1.map((v, k) => (v * 1e6) / (T2[k]! * 1e6 + FLT_EPS));
    let shape: Shape = { h1: unitIr(IR1_TAPS), h2: unitIr(IR2_TAPS), H1: H, H2: T2, freq: loud.freq };
    shape = this.iterAmp(span(x, 23, 5), span(yl, 23, 5), 3, shape);
    shape = this.iterAmp(span(x, 6, 15), span(yl, 6, 15), 2, shape);
    shape = this.iterAmp(span(x, 30, 20), span(yl, 30, 20), 5, shape);
    const h2 = this.finalIr2(span(x, 50, 20), span(yl, 50, 20), shape.h1, shape.h2);
    return { sat: this.sat, iir2: this.iir2, h1: shape.h1, h2, latency: lat };
  }
}

/** HTKPA::startClone on the DI and the model's output, both at `fs` and at least 70 s long. */
export function startClone(x: Float64Array, y: Float64Array, fs: number): StartCloneResult {
  if (x.length < 70 * fs || y.length < 70 * fs) throw new Error('the clone fit needs 70 s of DI and output');
  return new Fit(fs).run(x, y);
}

/** Samples of history a WaveNet output depends on. */
function receptiveField(model: Wavenet): number {
  return model.arrays.reduce((s, la) => s + la.layers.reduce((t, l) => t + l.dilation * (l.convW.length - 1), 0) + la.headW.length - 1, 0);
}

/**
 * runWavenet in blocks, each warmed up on the receptive field before it: the same output (every
 * sample's arithmetic is unchanged) in a fraction of the memory of one 70 s pass. Like
 * NeuralAmpModelerCore's prewarm, the model first hears a receptive field of silence, so its
 * output starts settled instead of with the start-up transient of an all-zero state.
 */
export function runWavenetBlocks(x: Float64Array, model: Wavenet, block = 1 << 18): Float64Array {
  const warm = receptiveField(model);
  const padded = new Float64Array(warm + x.length);
  padded.set(x, warm);
  const out = new Float64Array(x.length);
  for (let at = 0; at < x.length; at += block) {
    const end = Math.min(x.length, at + block);
    out.set(runWavenet(padded.slice(at, warm + end), model).subarray(warm), at);
  }
  return out;
}

/** Rounds half away from zero, as lround. */
const lround = (v: number) => Math.sign(v) * Math.round(Math.abs(v));
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** The DI at the model's rate, kept at 24 bits as the editor's cached WAV. */
export function diAtRate(di44100: Float32Array, fs: number): Float64Array {
  const x = Float64Array.from(di44100);
  const r = fs === DI_RATE ? x : resample(x, fs, DI_RATE);
  return r.map((v) => lround(clamp1(v) * 8388607) / 8388608);
}

/** The model's output x 0.31, kept at 16 bits as the editor's WAV. */
export function renderTarget(model: Wavenet, di: Float64Array): Float64Array {
  const gain = f32(MODEL_OUTPUT_GAIN);
  return runWavenetBlocks(di, model).map((v) => lround(clamp1(f32(f32(v) * gain)) * 32767) / 32768);
}

/** An IR at `fs` resampled to the device's 44.1 kHz, `taps` long. */
function toDevice(h: Float64Array, fs: number, taps: number): Float32Array {
  const out = new Float32Array(taps);
  if (fs === DEVICE_RATE) out.set(h.subarray(0, taps));
  else if (fs > DEVICE_RATE && fs < 2 * DEVICE_RATE) out.set(r8bResample(h, fs, DEVICE_RATE, taps));
  else out.set(resample(h, DEVICE_RATE, fs).subarray(0, taps));
  return out;
}

/** The fit's result as .clo arrays (codec.ts): IRs at 44.1 kHz, gains and IIR 2 as float32. */
export function startCloneArrays(r: StartCloneResult, fs: number): CloArrays {
  const { apos, aneg, kp, kn } = r.sat;
  const q = r.iir2;
  return {
    arrayA: toDevice(r.h1, fs, IR1_TAPS),
    arrayB: toDevice(r.h2, fs, IR2_TAPS),
    gains: [f32(apos), f32(aneg), f32(kp), f32(kn)],
    biquad: [q.b0, q.b1, q.b2, q.a1, q.a2],
  };
}

/** The whole Matribox conversion: .nam text and the 70 s reference DI (float32, 44.1 kHz) -> .clo arrays. */
export function generateMatriboxClo(namJson: string, di44100: Float32Array): CloArrays {
  const model = parseNam(namJson);
  const fs = model.sampleRate ?? 48000;
  const x = diAtRate(di44100, fs);
  return startCloneArrays(startClone(x, renderTarget(model, x), fs), fs);
}
