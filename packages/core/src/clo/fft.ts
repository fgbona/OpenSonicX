/**
 * Radix-2 complex FFT (unnormalized, like rustfft) plus the real-signal helpers and Welch-Wiener
 * transfer estimate the clone fit uses. Ported from SonicMaster (MIT; clo_dsp.dart at 931a68f).
 */

export const NFFT = 8192;
export const BINS = NFFT / 2 + 1;
export const WELCH_HOP = NFFT / 4;

export class Fft {
  readonly n: number;
  readonly #rev: Int32Array;
  readonly #cos: Float64Array;
  readonly #sin: Float64Array;
  readonly #negSin: Float64Array;
  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.n = n;
    const bits = Math.log2(n);
    this.#rev = Int32Array.from({ length: n }, (_, i) => {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      return r;
    });
    this.#cos = Float64Array.from({ length: n / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / n));
    this.#sin = Float64Array.from({ length: n / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / n));
    this.#negSin = this.#sin.map((v) => -v);
  }
  /** In place. Forward uses e^{-i}, inverse e^{+i}; neither divides by n. */
  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.#rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    const cos = this.#cos;
    const sin = inverse ? this.#sin : this.#negSin;
    // Butterflies within a stage are independent, so twiddle-outer order gives identical results.
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let j = 0; j < half; j++) {
        const wr = cos[j * step]!;
        const wi = sin[j * step]!;
        for (let a = j; a < n; a += len) {
          const b = a + half;
          const rb = re[b]!,
            ib = im[b]!;
          const tr = wr * rb - wi * ib;
          const ti = wr * ib + wi * rb;
          const ra = re[a]!,
            ia = im[a]!;
          re[b] = ra - tr;
          im[b] = ia - ti;
          re[a] = ra + tr;
          im[a] = ia + ti;
        }
      }
    }
  }
}

let cached: Fft | null = null;
export const fft = (): Fft => (cached ??= new Fft(NFFT));

export interface Spectrum {
  readonly re: Float64Array;
  readonly im: Float64Array;
}

/** First BINS bins of the DFT of a real NFFT-long signal. */
export function rfft(signal: Float64Array): Spectrum {
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  re.set(signal.subarray(0, NFFT));
  fft().transform(re, im, false);
  return { re: re.slice(0, BINS), im: im.slice(0, BINS) };
}

/** Real inverse from BINS Hermitian bins; NFFT samples, unnormalized. */
export function irfft(re: Float64Array, im: Float64Array): Float64Array {
  const fr = new Float64Array(NFFT);
  const fi = new Float64Array(NFFT);
  for (let k = 0; k < BINS; k++) {
    fr[k] = re[k]!;
    fi[k] = im[k]!;
  }
  for (let k = 1; k < NFFT / 2; k++) {
    fr[NFFT - k] = re[k]!;
    fi[NFFT - k] = -im[k]!;
  }
  fft().transform(fr, fi, true);
  return fr;
}

export function hann(): Float64Array {
  return Float64Array.from({ length: NFFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT));
}

/** Welch-averaged H = sum(Y conj X) / (sum |X|^2 + reg * max). */
export function welchPairs(pairs: readonly (readonly [Float64Array, Float64Array])[], reg: number): Spectrum {
  const win = hann();
  const xr = new Float64Array(NFFT);
  const xi = new Float64Array(NFFT);
  const yr = new Float64Array(NFFT);
  const yi = new Float64Array(NFFT);
  const sxyRe = new Float64Array(BINS);
  const sxyIm = new Float64Array(BINS);
  const sxx = new Float64Array(BINS);
  for (const [x, y] of pairs) {
    const lim = Math.min(x.length, y.length);
    for (let start = 0; start + NFFT <= lim; start += WELCH_HOP) {
      for (let i = 0; i < NFFT; i++) {
        xr[i] = x[start + i]! * win[i]!;
        xi[i] = 0;
        yr[i] = y[start + i]! * win[i]!;
        yi[i] = 0;
      }
      fft().transform(xr, xi, false);
      fft().transform(yr, yi, false);
      for (let i = 0; i < BINS; i++) {
        const axr = xr[i]!,
          axi = xi[i]!,
          ayr = yr[i]!,
          ayi = yi[i]!;
        sxyRe[i]! += ayr * axr + ayi * axi;
        sxyIm[i]! += ayi * axr - ayr * axi;
        sxx[i]! += axr * axr + axi * axi;
      }
    }
  }
  let sxxMax = 0;
  for (let i = 0; i < BINS; i++) if (sxx[i]! > sxxMax) sxxMax = sxx[i]!;
  const eps = reg * sxxMax;
  const re = new Float64Array(BINS);
  const im = new Float64Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const den = sxx[i]! + eps;
    re[i] = sxyRe[i]! / den;
    im[i] = sxyIm[i]! / den;
  }
  return { re, im };
}

/** First `nTaps` of the impulse response of `h`. */
export function firify(h: Spectrum, nTaps: number): Float64Array {
  const ir = irfft(h.re, h.im);
  return Float64Array.from({ length: nTaps }, (_, i) => ir[i]! / NFFT);
}
