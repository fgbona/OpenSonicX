/**
 * The sample-rate converter the Matribox II Pro's official tool runs on a user IR: r8brain-free-src
 * 1.6 (Aleksey Vaneev, MIT; see NOTICE), CDSPResampler24, ported for the one path it takes when
 * the source rate is under twice the target (48 kHz -> 44.1 kHz):
 *
 *   1. 2x upsampling (zero stuffing) through a linear-phase low-pass FIR: Kaiser-windowed sinc,
 *      transition band 2 %, 180.15 dB stop band, gain 2, cut-off at the target Nyquist.
 *   2. CDSPFracInterpolator<24, 673>: 24-tap fractional-delay filters at 673 positions, with a
 *      second-order spline between neighbouring positions.
 *
 * r8brain filters by FFT block convolution; this port convolves in the time domain, which is the
 * same arithmetic up to rounding far below the int24 output step. The library version and the
 * filter parameters were read off the official tool's binary (symbol names and constants); the
 * output matches the official upload of a 48 kHz IR sample for sample (docs/matribox.md).
 */
const PI = 3.14159265358979324;
const ATTEN = 180.15;
const TRANS_BAND = 2.0;
const KAISER_BETA = 125.0;
const FRAC_TAPS = 24;
const FRACS = 673;
const ELEMENT = 3;
const SPLINE_POINTS = 8;
/** Kaiser beta and power for 12-tap half fractional-delay filters (r8brain's table, 180.15 dB). */
const FRAC_BETA = 12.55262798;
const FRAC_POWER = 1.51553897;
/** Stop-band attenuation corrections for transition bands under 10 %, scaled by 1/196. */
const ATTEN_CORRS = [
  -15, -17, -20, -20, -20, -21, -20, -16, -17, -18, -17, -13, -12, -11, -9, -7, -5, -4, -1, 1, 3, 4, 5, 6, 7, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12, 10, 11, 10, 10, 8, 10, 11, 10,
  11, 11, 13, 14, 15, 19, 27, 26, 23, 18, 14, 8, 4, -2, -6, -12, -17, -23, -28, -33, -37, -42, -46, -49, -53, -57, -60, -61, -64, -65, -67, -66, -66, -66, -65, -64, -61, -59, -56, -52,
  -48, -42, -38, -31, -27, -19, -13, -7, -1, 8, 14, 22, 29, 37, 45, 52, 59, 66, 73, 80, 86, 91, 96, 100, 104, 108, 111, 114, 115, 117, 118, 120, 120, 118, 117, 114, 113, 111, 107, 103,
  99, 95, 89, 84, 78, 72, 66, 60, 52, 44, 37, 30, 21, 14, 6, -3, -11, -18, -26, -34, -43, -51, -58, -65, -73, -78, -85, -90, -97, -102, -107, -113, -115, -118, -121, -125, -125, -126,
  -126, -126, -125, -124, -121, -119, -115, -111, -109, -101, -102, -95, -88, -81, -73, -67, -63, -54, -47, -40, -33, -26, -18, -11, -5, 2, 8, 14, 19, 25, 31, 36, 37, 43, 47, 49, 51,
  52, 57, 57, 56, 57, 58, 58, 58, 57, 56, 52, 52, 50, 48, 44, 41, 39, 37, 33, 31, 26, 24, 21, 18, 14, 11, 8, 4, 2, -2, -5, -7, -9, -11, -13, -15, -16, -18, -19, -20, -23, -24, -24,
  -25, -27, -26, -27, -29, -30, -31, -32, -35, -36, -39, -40, -44, -46, -51, -54, -59, -63, -69, -76, -83, -91, -98,
] as const;

const sqr = (x: number) => x * x;
const pows = (v: number, p: number) => (v < 0 ? -Math.pow(-v, p) : Math.pow(v, p));

/** sin(ph), sin(ph + si), … by the recurrence r8brain uses (CSineGen). */
function sineGen(si: number, ph: number): () => number {
  let s1 = Math.sin(ph);
  let s2 = Math.sin(ph - si);
  const inc = 2 * Math.cos(si);
  return () => {
    const r = s1;
    s1 = inc * r - s2;
    s2 = r;
    return r;
  };
}

/** r8brain's polynomial approximation of the modified Bessel function I0. */
function besselI0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = sqr(x / 3.75);
    return 1.0 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.360768e-1 + y * 0.45813e-2)))));
  }
  const y = 3.75 / ax;
  const poly = 0.39894228 + y * (0.1328592e-1 + y * (0.225319e-2 + y * (-0.157565e-2 + y * (0.916281e-2 + y * (-0.2057706e-1 + y * (0.2635537e-1 + y * (-0.1647633e-1 + y * 0.392377e-2)))))));
  return (Math.exp(ax) / Math.sqrt(ax)) * poly;
}

/** Kaiser window samples from position `wn` on, raised to `power`. */
function kaiser(len2: number, beta: number, wn: number, fracDelay: number, power: number): () => number {
  const div = besselI0(beta);
  const len2Frac = fracDelay / len2;
  let n = wn;
  return () => {
    const x = 1.0 - sqr(n / len2 + len2Frac);
    n++;
    return pows(x < 0 ? 0 : besselI0(beta * Math.sqrt(x)) / div, power);
  };
}

/** Half length, cut-off shift and window power of the low-pass filter (CDSPFIRFilter::buildLPFilter, transition band < 10 %, attenuation >= 117 dB). */
function lowPassShape(): { hl: number; fo1: number; pwr: number } {
  const tb = TRANS_BAND * 0.01;
  const base = -ATTEN - 0.21;
  const corr = Math.min(ATTEN_CORRS.length - 1, Math.max(0, Math.floor(((-base - 49.0) * 264) / 176.25 + 0.5)));
  const atten = base - ATTEN_CORRS[corr]! / 196.0;
  const pwr =
    7.43932822146293e-8 * sqr(atten) +
    0.000102747434588003 * Math.cos(0.00785021930010397 * atten) * Math.cos(0.633854318781239 + 0.103208573657699 * atten) -
    0.00798132247867036 -
    0.000903555213543865 * atten -
    0.0969365532127236 * Math.exp(0.0779275237937911 * atten) -
    1.37304948662012e-5 * atten * Math.cos(0.00785021930010397 * atten);
  // pwr > 0.0677 at 180.15 dB: the only one of r8brain's two fits this filter reaches
  const hl = (1.15990238966306 * pwr - 5.02124037125213 * sqr(pwr) - 0.158676856669827 * atten * Math.cos(1.1609073390614 * pwr - 6.33932586197475 * pwr * sqr(pwr))) / tb;
  const fo1 = 0.867344453126885 * tb + 0.052693817907757 * tb * Math.log(pwr) + 0.0895511178735932 * tb * Math.atan(59.7538527741309 * pwr) - 0.0745653568081453 * pwr * tb;
  return { hl, fo1, pwr };
}

/** The zero-phase low-pass kernel h[-fl2..fl2] (stored from index 0), summing to `gain`. */
function lowPassKernel(normFreq: number, gain: number): { h: Float64Array; fl2: number } {
  const { hl, fo1, pwr } = lowPassShape();
  const len2 = (0.25 * hl) / normFreq;
  const freq2 = PI * (1.0 - fo1) * normFreq;
  const fl2 = Math.floor(len2);
  const win = kaiser(len2, KAISER_BETA, 0, 0, Math.abs(pwr));
  const f1 = sineGen(0, 0);
  const f2 = sineGen(freq2, 0);
  f1();
  f2();
  const h = new Float64Array(2 * fl2 + 1);
  h[fl2] = (freq2 * win()) / PI;
  for (let t = 1; t <= fl2; t++) {
    const v = ((f2() - f1()) * win()) / t / PI;
    h[fl2 + t] = v;
    h[fl2 - t] = v;
  }
  let sum = 0;
  for (const v of h) sum += v;
  const scale = gain / sum;
  return { h: h.map((v) => v * scale), fl2 };
}

/** One fractional-delay filter (CDSPSincFilterGen::generateFrac), normalised to unity gain. */
function fracFilter(frac: number): Float64Array {
  const len2 = FRAC_TAPS / 2;
  const fl2 = Math.ceil(len2);
  const win = kaiser(len2, FRAC_BETA, -fl2, frac, FRAC_POWER);
  const f0 = Math.sin(frac * PI);
  const sinAt = (t: number) => (t & 1 ? -f0 : f0); // sin(pi * (t + frac))
  const out = new Float64Array(FRAC_TAPS);
  let at = 0;
  let t = -fl2;
  if (t + frac < -len2) {
    win();
    out[at++] = 0;
    t++;
  }
  const mt = frac >= 1.0 - 1e-13 && frac <= 1.0 + 1e-13 ? -1 : 0;
  for (; t < mt; t++) out[at++] = (sinAt(t) * win()) / (t + frac) / PI;
  const ut = t + frac;
  out[at] = Math.abs(ut) <= 1e-13 ? win() : (sinAt(t) * win()) / ut / PI;
  for (; t < fl2 - 2; ) {
    t++;
    out[++at] = (sinAt(t) * win()) / (t + frac) / PI;
  }
  t++;
  out[++at] = t + frac > len2 ? 0 : (sinAt(t) * win()) / (t + frac) / PI;
  let sum = 0;
  for (const v of out) sum += v;
  return out.map((v) => v * (1.0 / sum));
}

/** CDSPFracDelayFilterBank<24, 673, 3, 8>: per position and tap, spline coefficients c0, c1, c2. */
function fracBank(): Float64Array {
  const rows = Array.from({ length: FRACS + SPLINE_POINTS }, (_, r) => fracFilter((FRACS - (r - SPLINE_POINTS / 2 + 1)) / FRACS));
  const bank = new Float64Array((FRACS + 1) * FRAC_TAPS * ELEMENT);
  for (let r = 0; r <= FRACS; r++) {
    for (let i = 0; i < FRAC_TAPS; i++) {
      const [xm3, xm2, xm1, x0, x1, x2, x3, x4] = rows.slice(r, r + SPLINE_POINTS).map((row) => row[i]!) as [number, number, number, number, number, number, number, number];
      const at = (r * FRAC_TAPS + i) * ELEMENT;
      bank[at] = x0;
      bank[at + 1] = (61.0 * (x1 - xm1) + 16.0 * (xm2 - x2) + 3.0 * (x3 - xm3)) / 76.0;
      bank[at + 2] = (106.0 * (xm1 + x1) + 10.0 * x3 + 6.0 * xm3 - 3.0 * x4 - 29.0 * (xm2 + x2) - 167.0 * x0) / 76.0;
    }
  }
  return bank;
}

let bankCache: Float64Array | undefined;

/**
 * The first `outLen` samples of `x` (at `src` Hz) resampled to `dst` Hz, as r8brain 1.6's
 * CDSPResampler24 streams them (input before 0 and after its end is silence). Only the path for
 * dst < src < 2 * dst is ported.
 */
export function r8bResample(x: ArrayLike<number>, src: number, dst: number, outLen: number): Float64Array {
  if (!(src > dst && src < 2 * dst)) throw new RangeError(`only dst < src < 2 * dst is ported (got ${src} -> ${dst})`);
  const { h, fl2 } = lowPassKernel((0.5 * dst) / src, 2.0);
  const rate2 = src * 2;
  // z[n] = sum_k h[k] up[n + k], up = x at even indices, zero at odd ones
  const zLen = Math.ceil((outLen * rate2) / dst) + FRAC_TAPS + 2;
  const z = new Float64Array(zLen);
  for (let n = 0; n < zLen; n++) {
    let s = 0;
    for (let k = -fl2; k <= fl2; k++) {
      const m = n + k;
      if (m < 0 || m & 1 || m >> 1 >= x.length) continue;
      s += h[fl2 + k]! * (x[m >> 1] as number);
    }
    z[n] = s;
  }
  bankCache ??= fracBank();
  const bank = bankCache;
  const zAt = (i: number) => (i < 0 || i >= zLen ? 0 : z[i]!);
  const out = new Float64Array(outLen);
  let posInt = 0;
  let posFrac = 0;
  for (let j = 0; j < outLen; j++) {
    const scaled = posFrac * FRACS;
    const fti = Math.trunc(scaled);
    const fx = scaled - fti;
    const fx2 = fx * fx;
    let s = 0;
    for (let i = 0; i < FRAC_TAPS; i++) {
      const c = (fti * FRAC_TAPS + i) * ELEMENT;
      s += (bank[c]! + bank[c + 1]! * fx + bank[c + 2]! * fx2) * zAt(posInt - (FRAC_TAPS / 2 - 1) + i);
    }
    out[j] = s;
    const next = ((j + 1) * rate2) / dst;
    posInt = Math.trunc(next);
    posFrac = next - posInt;
  }
  return out;
}
