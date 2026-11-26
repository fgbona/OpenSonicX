/**
 * What the Matribox II Pro's CLONE block plays for a `.clo`, offline: the firmware's chain (gain ->
 * IIR 1 -> IR 1 -> 4x oversampled saturator -> IIR 2 -> IR 2) at 44.1 kHz with the block's knobs at
 * their defaults (Gain, Volume, Bass, Middle, Treble 50: unity gain, flat tone stack), from the
 * capture's bytes as the unit reads them (the first 0x2000; IR 2 cut to 1024 taps).
 *
 * Ported from waveod's src/blocks/clone/clone.c (github.com/zxmarcos/waveod, MIT, Copyright (c) 2026
 * Marcos Medeiros; see NOTICE), a bit-exact rebuild of the firmware's ToneCloneProcess. This port is
 * not bit-exact: the convolutions are direct (the firmware's partitioned FFT gives the same linear
 * convolution at unity gain) and JavaScript has no fused multiply-add. Checked against waveod's C
 * block on a random capture and a noise DI: the difference is 98 dB under the output.
 */
import { syntheticDi } from './synthetic-di.ts';

const STORED = 0x2000;
const BLOCK = 64;
const IR2_MAX = 1024;
const f32 = Math.fround;

/** HT_COEFFS_UP_IIR / HT_COEFFS_DOWN_IIR: the half-band all-pass interpolators (orders 7, 5) and decimators (6, 4). */
const UP7 = [0.045728147, 0.3325011, 0.66320205, 0.93385583, 0.16808754, 0.5044857, 0.80378085].map(f32);
const UP5 = [0.05423078, 0.39879698, 0.86291784, 0.19969958, 0.62109685].map(f32);
const DN6 = [0.054217525, 0.38308734, 0.74872094, 0.19679797, 0.5731364, 0.9142937].map(f32);
const DN4 = [0.07076595, 0.51316756, 0.2578531, 0.81731737].map(f32);

interface Capture {
  readonly iir: readonly [Float64Array, Float64Array];
  readonly sat: readonly [number, number, number, number];
  readonly ir1: Float64Array;
  readonly ir2: Float64Array;
}

/** The capture as the block's init reads it; null when the block would play silence. */
function readCapture(clo: Uint8Array): Capture | null {
  const d = clo.subarray(0, STORED);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (at: number) => (at + 4 <= d.length ? v.getUint32(at, true) : 0);
  const len1 = u32(0x7c);
  const len2 = Math.min(u32(0x84), IR2_MAX);
  if (!len1 || !len2 || d.length < 0x88 || d[0x12] || d[0x13]) return null;
  const doubles = (at: number) => Float64Array.from({ length: 5 }, (_, i) => v.getFloat64(at + 8 * i, true));
  const ir = (off: number, len: number) =>
    Float64Array.from({ length: len }, (_, i) => {
      const at = 0x88 + 4 * ((off | 0) + i);
      return at >= 0 && at + 4 <= d.length ? v.getFloat32(at, true) : 0;
    });
  const sat = [0, 1, 2, 3].map((i) => v.getFloat32(0x68 + 4 * i, true)) as [number, number, number, number];
  return { iir: [doubles(0x18), doubles(0x40)], sat, ir1: ir(u32(0x78), len1), ir2: ir(u32(0x80), len2) };
}

/** Direct form II in double, x 1000 in and (float)(y x 0.001) out, as the firmware runs both IIRs. */
function iir(c: Float64Array, x: Float32Array): Float32Array {
  const [b0, b1, b2, a1, a2] = c as unknown as [number, number, number, number, number];
  let s1 = 0;
  let s2 = 0;
  return x.map((w) => {
    const v = w * 1000 - (s2 * a2 + s1 * a1);
    const y = b0 * v + (b1 * s1 + b2 * s2);
    s2 = s1;
    s1 = v;
    return f32(f32(y) * 0.001);
  });
}

/** Linear convolution, the length of `x`. */
function convolve(x: Float32Array, h: Float64Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let acc = 0;
    for (let k = 0, m = Math.min(n + 1, h.length); k < m; k++) acc += (h[k] as number) * (x[n - k] as number);
    out[n] = acc;
  }
  return out;
}

/** One all-pass section per coefficient: y = s + c x, s = x - y c (state updated in place). */
function allpass(c: readonly number[], s: Float64Array, from: number, to: number, x: number): number {
  let a = x;
  for (let i = from; i < to; i++) {
    const y = f32(f32((c[i] as number) * a) + (s[i] as number));
    s[i] = f32(a - f32(y * (c[i] as number)));
    a = y;
  }
  return a;
}

/** Interpolator of `c.length` sections: branch A the first order - order/2, branch B the rest. */
const up2x = (c: readonly number[], s: Float64Array, x: number): [number, number] => {
  const na = c.length - (c.length >> 1);
  return [allpass(c, s, 0, na, x), allpass(c, s, na, c.length, x)];
};

/** The saturator 4x oversampled: A - e^(k x) A per polarity (x > 0: A = p50, k = -p58; else A = -p54, k = p5c). */
function saturate(x: Float32Array, [p50, p54, p58, p5c]: readonly number[]): Float32Array {
  const u1 = new Float64Array(7);
  const u2 = new Float64Array(5);
  const d6 = new Float64Array(6);
  const d4 = new Float64Array(4);
  const last = { d6: 0, d4: 0 };
  const shape = (v: number) => {
    const a = v > 0 ? (p50 as number) : -(p54 as number);
    const k = v > 0 ? -(p58 as number) : (p5c as number);
    return f32(a - f32(Math.exp(f32(k * v))) * a);
  };
  /** Decimator: one output from two inputs, branch B a sample late. */
  const down = (c: readonly number[], s: Float64Array, which: 'd6' | 'd4', a: number, b: number) => {
    const na = c.length - (c.length >> 1);
    const out = f32(f32(last[which] + allpass(c, s, 0, na, a)) * 0.5);
    last[which] = allpass(c, s, na, c.length, b);
    return out;
  };
  return x.map((v) => {
    const [h0, h1] = up2x(UP7, u1, v);
    const q = [...up2x(UP5, u2, h0), ...up2x(UP5, u2, h1)].map(shape) as [number, number, number, number];
    return down(DN6, d6, 'd6', down(DN4, d4, 'd4', q[0], q[1]), down(DN4, d4, 'd4', q[2], q[3]));
  });
}

/**
 * The CLONE block's output for `input` (mono, 44.1 kHz) with `clo` loaded and the knobs at 50; the
 * input is cut to whole 64-sample blocks, as the firmware only runs whole blocks. Silence for a
 * capture the block does not play.
 */
export function simulateClo(clo: Uint8Array, input: Float32Array): Float32Array {
  const x = input.subarray(0, input.length - (input.length % BLOCK));
  const c = readCapture(clo);
  if (!c) return new Float32Array(x.length);
  const ir1 = convolve(iir(c.iir[0], Float32Array.from(x)), c.ir1);
  return convolve(iir(c.iir[1], saturate(ir1, c.sat)), c.ir2);
}

export interface CloCheck {
  readonly ok: boolean;
  /** RMS of the simulated output, dBFS. */
  readonly rmsDb: number;
  /** Peak of the simulated output (1 = full scale). */
  readonly peak: number;
  /** Why it is refused, when it is. */
  readonly problem?: 'silent' | 'clipped' | 'broken';
}

const SILENT_DB = -70;
/**
 * The block computes in float, so a peak over 1 is not broken by itself: the official editor's
 * capture of 5 RECTIFIER peaks at 1.35 on the reference DI's noise sections and 0.82 (-13.5 dB RMS)
 * on its guitar. Refused: a sustained level near full scale, or peaks 12 dB over it.
 */
const LOUD_DB = -3;
const CLIP_PEAK = 4;

/**
 * The probe checkClo is meant for: 3 s of the synthetic DI at a quarter of its level (peaks of
 * -12 dBFS, like a guitar's). The official 5 RECTIFIER capture plays it at -13.9 dB RMS, as it
 * plays the reference DI's guitar section (-13.5 dB), so no 12 MB download is needed to check.
 */
export function cloProbe(): Float32Array {
  return syntheticDi(3 * 44100).map((v) => v * 0.25);
}

/**
 * A sanity check of a conversion before it is uploaded: the CLONE block simulated on `probe` (a DI
 * at a guitar's level, 44.1 kHz: cloProbe) must not be silent, far too loud or produce NaN.
 */
export function checkClo(clo: Uint8Array, probe: Float32Array): CloCheck {
  const y = simulateClo(clo, probe);
  let peak = 0;
  let energy = 0;
  for (const v of y) {
    peak = Math.max(peak, Math.abs(v));
    energy += v * v;
  }
  const rmsDb = 10 * Math.log10(energy / Math.max(1, y.length) + 1e-30);
  if (!Number.isFinite(energy)) return { ok: false, rmsDb, peak, problem: 'broken' };
  if (rmsDb < SILENT_DB) return { ok: false, rmsDb, peak, problem: 'silent' };
  if (peak > CLIP_PEAK || rmsDb > LOUD_DB) return { ok: false, rmsDb, peak, problem: 'clipped' };
  return { ok: true, rmsDb, peak };
}
