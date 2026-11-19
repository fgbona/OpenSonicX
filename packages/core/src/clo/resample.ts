/** Windowed-sinc (Blackman, 16 taps each side) arbitrary-ratio resampling. Ported from SonicMaster (MIT). */

function sinc(x: number): number {
  if (Math.abs(x) < 1e-9) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

function blackman(d: number, half: number): number {
  if (Math.abs(d) > half) return 0;
  const n = (d + half) / (2 * half);
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
}

/** Resamples by up/down; `maxOut` caps the output (its leading samples equal the full result's). */
export function resample(x: Float64Array, up: number, down: number, maxOut?: number): Float64Array {
  const ratio = up / down;
  const natural = Math.floor(x.length * ratio);
  const outLen = maxOut !== undefined ? Math.min(natural, maxOut) : natural;
  const half = 16;
  const cutoff = Math.min(up, down) / Math.max(up, down);
  const out = new Float64Array(outLen);
  for (let kk = 0; kk < outLen; kk++) {
    const center = kk / ratio;
    const i0 = Math.floor(center);
    let acc = 0;
    for (let j = i0 - half; j <= i0 + half; j++) {
      if (j < 0 || j >= x.length) continue;
      const d = center - j;
      acc += x[j]! * cutoff * sinc(cutoff * d) * blackman(d, half);
    }
    out[kk] = acc;
  }
  return out;
}
