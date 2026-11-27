/** The Matribox global EQ's frequency response, from the RBJ Audio EQ Cookbook biquads. */

export const EQ_FS = 48000;
export const EQ_MIN_HZ = 20;
export const EQ_MAX_HZ = 20000;

// ponytail: the unit's real filter shapes are not known. Each band's Q comes from the globals when it is a
// usable number (docs/matribox.md "Global EQ": Q words 2, 9, 13, 17, 21, 29); the fallbacks are Q 1 for a
// band and 0.707 for a cut, and the cuts are drawn as 2nd-order filters. Ceiling: the curve is an estimate,
// not a measurement. Upgrade path: compare it with a sweep of the unit and fix the shapes that differ.
const BAND_Q = 1;
const CUT_Q = Math.SQRT1_2;

export interface EqFilter {
  readonly frequency: number;
  readonly q?: number;
}
export interface EqBandSpec extends EqFilter {
  readonly gain: number;
  /** A band that is off adds nothing. */
  readonly on?: boolean;
}
export interface EqSpec {
  readonly bands: readonly EqBandSpec[];
  /** Leave out (null) a cut that is off. */
  readonly lowCut?: EqFilter | null;
  readonly highCut?: EqFilter | null;
}

type Biquad = readonly [b0: number, b1: number, b2: number, a0: number, a1: number, a2: number];

const usableQ = (q: number | undefined, fallback: number) => (q !== undefined && Number.isFinite(q) && q > 0 ? q : fallback);

function peaking(f: number, q: number, gainDb: number): Biquad {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * f) / EQ_FS;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return [1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A];
}

function highPass(f: number, q: number): Biquad {
  const w = (2 * Math.PI * f) / EQ_FS;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha];
}

function lowPass(f: number, q: number): Biquad {
  const w = (2 * Math.PI * f) / EQ_FS;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha];
}

/** |H(e^jw)|^2 of one biquad at frequency f. */
function power([b0, b1, b2, a0, a1, a2]: Biquad, f: number): number {
  const w = (2 * Math.PI * f) / EQ_FS;
  const mag = (x0: number, x1: number, x2: number) => {
    const re = x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w);
    const im = -(x1 * Math.sin(w) + x2 * Math.sin(2 * w));
    return re * re + im * im;
  };
  return mag(b0, b1, b2) / mag(a0, a1, a2);
}

/** The filters the spec turns on, as biquads. */
export function eqBiquads(spec: EqSpec): Biquad[] {
  const filters: Biquad[] = [];
  if (spec.lowCut) filters.push(highPass(spec.lowCut.frequency, usableQ(spec.lowCut.q, CUT_Q)));
  if (spec.highCut) filters.push(lowPass(spec.highCut.frequency, usableQ(spec.highCut.q, CUT_Q)));
  for (const b of spec.bands) {
    if (b.on !== false && b.gain !== 0) filters.push(peaking(b.frequency, usableQ(b.q, BAND_Q), b.gain));
  }
  return filters;
}

/** The response in dB at one frequency. */
export function eqResponseDb(spec: EqSpec, f: number): number {
  return eqResponseOf(eqBiquads(spec), f);
}

export function eqResponseOf(filters: readonly Biquad[], f: number): number {
  const p = filters.reduce((acc, bq) => acc * power(bq, f), 1);
  return 10 * Math.log10(p);
}

/** `points` log-spaced frequencies from 20 Hz to 20 kHz with the response at each. */
export function eqCurve(spec: EqSpec, points = 200): { f: number; db: number }[] {
  const filters = eqBiquads(spec);
  const ratio = Math.log(EQ_MAX_HZ / EQ_MIN_HZ);
  return Array.from({ length: points }, (_, i) => {
    const f = EQ_MIN_HZ * Math.exp((ratio * i) / (points - 1));
    return { f, db: eqResponseOf(filters, f) };
  });
}
