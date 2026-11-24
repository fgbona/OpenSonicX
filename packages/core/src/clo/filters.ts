/**
 * Filter design for the clone fit: minimum-phase FIR from a magnitude (real cepstrum), 1/6-octave
 * smoothing, and regularized overlap-add deconvolution. Ported from SonicMaster (MIT).
 */
import { BINS, fft, firify, hann, NFFT, rfft, WELCH_HOP, type Spectrum } from './fft.ts';

/**
 * Minimum-phase FIR with the magnitude of `h`, keeping the measured polarity. The pedal keeps
 * only arrayB's first 512 taps, so a front-loaded response is what survives the upload.
 */
export function minphaseFir(h: Spectrum, nTaps: number): Float64Array {
  const mag = Float64Array.from({ length: BINS }, (_, i) => Math.sqrt(h.re[i]! * h.re[i]! + h.im[i]! * h.im[i]!));
  const mp = minphaseMag(mag, nTaps);
  const ir = firify(h, NFFT);
  let dominant = 0;
  for (let i = 0; i < NFFT; i++) if (Math.abs(ir[i]!) > Math.abs(dominant)) dominant = ir[i]!;
  if (dominant < 0) for (let i = 0; i < nTaps; i++) mp[i] = -mp[i]!;
  return mp;
}

/** Min-phase FIR whose magnitude response is `mag` (log -> causal cepstral window -> exp). */
export function minphaseMag(mag: Float64Array, nTaps: number): Float64Array {
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) re[i] = Math.log(Math.max(mag[i < BINS ? i : NFFT - i]!, 1e-9));
  fft().transform(re, im, true);
  for (let i = 0; i < NFFT; i++) {
    const w = i === 0 || i === NFFT / 2 ? 1 : i < NFFT / 2 ? 2 : 0;
    re[i] = (re[i]! / NFFT) * w;
    im[i] = 0;
  }
  fft().transform(re, im, false);
  for (let i = 0; i < NFFT; i++) {
    const ex = Math.exp(re[i]!);
    const ph = im[i]!;
    re[i] = ex * Math.cos(ph);
    im[i] = ex * Math.sin(ph);
  }
  fft().transform(re, im, true);
  return Float64Array.from({ length: nTaps }, (_, i) => re[i]! / NFFT);
}

const POW2_NEG = 0.9438743126816935; // 2^(-0.5/6)
const POW2_POS = 1.0594630943592953; // 2^(0.5/6)

/** Smooths a magnitude spectrum over about 1/6 octave. */
export function logsmooth(mag: Float64Array): Float64Array {
  const out = new Float64Array(BINS);
  out[0] = mag[0]!;
  for (let i = 1; i < BINS; i++) {
    const rawLo = Math.trunc(i * POW2_NEG);
    const hi = Math.min(Math.trunc(i * POW2_POS) + 1, BINS);
    const lo = Math.min(Math.max(rawLo, 1), hi - 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += mag[j]!;
    out[i] = sum / (hi - lo);
  }
  return out;
}

/** Regularized frequency-domain deconvolution of `y` by FIR `b` (Hann overlap-add). */
export function deconv(y: Float64Array, b: Float64Array, reg: number): Float64Array {
  const win = hann();
  const bbuf = new Float64Array(NFFT);
  bbuf.set(b.subarray(0, Math.min(b.length, NFFT)));
  const hb = rfft(bbuf);
  let hmax = 0;
  for (let i = 0; i < BINS; i++) hmax = Math.max(hmax, hb.re[i]! * hb.re[i]! + hb.im[i]! * hb.im[i]!);
  const invRe = new Float64Array(BINS);
  const invIm = new Float64Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const den = hb.re[i]! * hb.re[i]! + hb.im[i]! * hb.im[i]! + reg * hmax;
    invRe[i] = hb.re[i]! / den;
    invIm[i] = -hb.im[i]! / den;
  }
  const out = new Float64Array(y.length);
  const norm = new Float64Array(y.length);
  const yr = new Float64Array(NFFT);
  const yi = new Float64Array(NFFT);
  for (let start = 0; start + NFFT <= y.length; start += WELCH_HOP) {
    for (let i = 0; i < NFFT; i++) {
      yr[i] = y[start + i]! * win[i]!;
      yi[i] = 0;
    }
    fft().transform(yr, yi, false);
    for (let i = 0; i < BINS; i++) {
      const ar = yr[i]!,
        ai = yi[i]!;
      yr[i] = ar * invRe[i]! - ai * invIm[i]!;
      yi[i] = ar * invIm[i]! + ai * invRe[i]!;
    }
    for (let k = 1; k < NFFT / 2; k++) {
      yr[NFFT - k] = yr[k]!;
      yi[NFFT - k] = -yi[k]!;
    }
    fft().transform(yr, yi, true);
    for (let i = 0; i < NFFT; i++) {
      out[start + i]! += (yr[i]! / NFFT) * win[i]!;
      norm[start + i]! += win[i]! * win[i]!;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / Math.max(norm[i]!, 1e-3);
  return out;
}
