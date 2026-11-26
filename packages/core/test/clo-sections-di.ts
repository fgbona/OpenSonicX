/** Test signals for the clone fit: Gaussian noise and a DI with the reference DI's sections. */

/** Deterministic white noise (xorshift + Box-Muller). */
export function noise(n: number, rms: number, seed = 0x5eed): Float64Array {
  let s = seed;
  const uni = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) + 0.5) / 4294967296;
  };
  return Float64Array.from({ length: n }, () => rms * Math.sqrt(-2 * Math.log(uni())) * Math.cos(2 * Math.PI * uni()));
}

/** A DI with the reference's sections, at `fs`. */
export function sectionsDi(fs: number): Float64Array {
  const d = new Float64Array(70 * fs);
  for (let i = 0; i < 5 * fs; i++) {
    const t = i / fs;
    d[i] = 10 ** ((t < 1 ? -60 + 30 * t : -30 + 7.5 * (t - 1)) / 20) * Math.sin(2 * Math.PI * 300 * t);
  }
  d[6 * fs] = 1;
  d.set(noise(15 * fs - 1, 0.0008, 1), 6 * fs + 1);
  for (let i = 0; i < 5 * fs; i++) {
    const t = i / fs;
    const k = Math.log(500);
    d[23 * fs + i] = 0.5623 * Math.min(1, Math.min(t, 5 - t) / 0.01) * Math.sin(((2 * Math.PI * 20 * 5) / k) * (Math.exp((t * k) / 5) - 1));
  }
  d.set(noise(20 * fs, 0.05, 2), 30 * fs);
  d.set(noise(20 * fs, 0.15, 3), 50 * fs);
  return d;
}
