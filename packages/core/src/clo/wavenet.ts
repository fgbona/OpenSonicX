/**
 * WaveNet forward pass over a mono signal, matching the reference loop and accumulation order
 * so results track it to rounding. Ported from SonicMaster (MIT; clo_dsp.dart at 931a68f).
 */
import type { Activation, Wavenet } from './nam.ts';

type Rows = Float64Array[];

/** out[r][j] = sum_i m[r][i] * x[i][j]; out rows are zeroed first. */
function matmulInto(m: readonly Float64Array[], x: Rows, out: Rows): void {
  const t = x[0]!.length;
  for (let r = 0; r < m.length; r++) {
    const mr = m[r]!;
    const outr = out[r]!;
    outr.fill(0, 0, t);
    for (let i = 0; i < mr.length; i++) {
      const w = mr[i]!;
      const xi = x[i]!;
      for (let j = 0; j < t; j++) outr[j]! += w * xi[j]!;
    }
  }
}

/** Causal dilated conv1d: tap k reads x shifted by dil*(K-1-k); out rows zeroed first. */
function conv1dInto(x: Rows, kernels: readonly (readonly Float64Array[])[], b: Float64Array, dil: number, out: Rows): void {
  const cout = kernels[0]!.length;
  const t = x[0]!.length;
  const k = kernels.length;
  const cin = x.length;
  for (let o = 0; o < cout; o++) out[o]!.fill(0, 0, t);
  for (let ki = 0; ki < k; ki++) {
    const kernel = kernels[ki]!;
    const shift = dil * (k - 1 - ki);
    for (let o = 0; o < cout; o++) {
      const kro = kernel[o]!;
      const outo = out[o]!;
      for (let tt = shift; tt < t; tt++) {
        const src = tt - shift;
        let acc = 0;
        for (let i = 0; i < cin; i++) acc += kro[i]! * x[i]![src]!;
        outo[tt]! += acc;
      }
    }
  }
  for (let o = 0; o < cout; o++) {
    const outo = out[o]!;
    const bo = b[o]!;
    for (let tt = 0; tt < t; tt++) outo[tt]! += bo;
  }
}

function tanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e2 = Math.exp(2 * x);
  return (e2 - 1) / (e2 + 1);
}

const activate = (act: Activation, v: number): number => (act.kind === 'tanh' ? tanh(v) : v >= 0 ? v : act.slope * v);

const rows = (n: number, t: number): Rows => Array.from({ length: n }, () => new Float64Array(t));

/** Runs the model over `mono` (48 kHz) and returns its output. */
export function runWavenet(mono: Float64Array, model: Wavenet): Float64Array {
  const t = mono.length;
  const cond: Rows = [mono];
  let head: Rows = [];
  let x: Rows = [mono];
  for (const la of model.arrays) {
    const ch = la.channels;
    const xx = rows(ch, t);
    matmulInto(la.rechannelW, x, xx);
    const acc = rows(ch, t);
    for (let i = 0; i < head.length && i < acc.length; i++) {
      const ai = acc[i]!;
      const hi = head[i]!;
      for (let j = 0; j < t; j++) ai[j]! += hi[j]!;
    }
    const conv = rows(ch, t);
    const mixin = rows(ch, t);
    const post = rows(ch, t);
    const ow = rows(ch, t);
    for (const layer of la.layers) {
      conv1dInto(xx, layer.convW, layer.convB, layer.dilation, conv);
      matmulInto(layer.mixinW, cond, mixin);
      for (let c = 0; c < ch; c++) {
        const cc = conv[c]!;
        const mm = mixin[c]!;
        const pc = post[c]!;
        for (let j = 0; j < t; j++) pc[j] = activate(layer.act, cc[j]! + mm[j]!);
      }
      for (let c = 0; c < ch; c++) {
        const ac = acc[c]!;
        const pc = post[c]!;
        for (let j = 0; j < t; j++) ac[j]! += pc[j]!;
      }
      matmulInto(layer.outW, post, ow);
      for (let c = 0; c < ch; c++) {
        const xc = xx[c]!;
        const oc = ow[c]!;
        const bc = layer.outB[c]!;
        for (let j = 0; j < t; j++) xc[j]! += oc[j]! + bc;
      }
    }
    const headOut = rows(la.headW[0]!.length, t);
    conv1dInto(acc, la.headW, la.headB, 1, headOut);
    x = xx;
    head = headOut;
  }
  const h0 = head[0]!;
  const out = new Float64Array(t);
  for (let j = 0; j < t; j++) out[j] = model.headScale * h0[j]!;
  return out;
}
