/**
 * A deterministic stand-in for the reference DI, for tests: xorshift32 noise under a slow
 * triangular envelope, built with integer arithmetic only so another language reproduces it bit
 * for bit. 1,480,000 samples at 44.1 kHz covers what the fit reads.
 */
export const SYNTHETIC_DI_LENGTH = 1480000;

export function syntheticDi(length = SYNTHETIC_DI_LENGTH): Float32Array {
  const out = new Float32Array(length);
  let x = 0x2545f491;
  const period = 88200; // two seconds
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    const noise = (x / 4294967296) * 2 - 1;
    const phase = i % period;
    const tri = phase < period / 2 ? phase / (period / 2) : 2 - phase / (period / 2);
    out[i] = noise * (0.05 + 0.95 * tri);
  }
  return out;
}
