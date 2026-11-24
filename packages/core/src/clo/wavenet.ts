/**
 * WaveNet forward pass over a mono signal, matching the reference loop and accumulation order
 * so results track it to rounding. Ported from SonicMaster (MIT; clo_dsp.dart at 931a68f).
 *
 * Each layer runs in time blocks so the working set stays in cache instead of streaming
 * channel-long rows (1.6 M samples, 12.8 MB each) for every multiply-add. Blocks go from the
 * end of the signal to the start: a layer's residual update then only touches samples the
 * remaining blocks' causal convolutions no longer read. Every sum keeps the reference order,
 * so the output is bit-identical to the plain loop.
 */
import type { Activation, Wavenet } from './nam.ts';

type Rows = Float64Array[];

/** Samples per block: a 16-channel block's buffers fit in L2. */
const BLOCK = 2048;

/** out[r][j] = sum_i m[r][i] * x[i][j] for j < n; out rows are zeroed first. */
function matmulInto(m: readonly Float64Array[], x: Rows, out: Rows, n: number): void {
  for (let r = 0; r < m.length; r++) {
    const mr = m[r]!;
    const outr = out[r]!;
    outr.fill(0, 0, n);
    let i = 0;
    for (; i + 4 <= mr.length; i += 4) {
      const w0 = mr[i]!, w1 = mr[i + 1]!, w2 = mr[i + 2]!, w3 = mr[i + 3]!;
      const x0 = x[i]!, x1 = x[i + 1]!, x2 = x[i + 2]!, x3 = x[i + 3]!;
      for (let j = 0; j < n; j++) {
        let a = outr[j]!;
        a += w0 * x0[j]!;
        a += w1 * x1[j]!;
        a += w2 * x2[j]!;
        a += w3 * x3[j]!;
        outr[j] = a;
      }
    }
    for (; i < mr.length; i++) {
      const w = mr[i]!;
      const xi = x[i]!;
      for (let j = 0; j < n; j++) outr[j]! += w * xi[j]!;
    }
  }
}

/**
 * Causal dilated conv1d for samples [start, start + n): tap k reads x shifted by dil*(K-1-k);
 * out[o][j] is sample start + j. `tmp` (n long) holds one tap's channel sum, so the sum over
 * input channels finishes before it is added, as in the reference.
 */
function conv1dBlock(x: Rows, kernels: readonly (readonly Float64Array[])[], b: Float64Array, dil: number, out: Rows, start: number, n: number, tmp: Float64Array): void {
  const cout = kernels[0]!.length;
  const k = kernels.length;
  const cin = x.length;
  for (let o = 0; o < cout; o++) out[o]!.fill(0, 0, n);
  for (let ki = 0; ki < k; ki++) {
    const kernel = kernels[ki]!;
    const shift = dil * (k - 1 - ki);
    const j0 = Math.max(0, shift - start);
    if (j0 >= n) continue;
    const base = start - shift;
    for (let o = 0; o < cout; o++) {
      const kro = kernel[o]!;
      tmp.fill(0, j0, n);
      let i = 0;
      // Four input channels per pass keep the running sum in a register; same order as one by one.
      for (; i + 4 <= cin; i += 4) {
        const w0 = kro[i]!, w1 = kro[i + 1]!, w2 = kro[i + 2]!, w3 = kro[i + 3]!;
        const x0 = x[i]!, x1 = x[i + 1]!, x2 = x[i + 2]!, x3 = x[i + 3]!;
        for (let j = j0; j < n; j++) {
          const s = base + j;
          let a = tmp[j]!;
          a += w0 * x0[s]!;
          a += w1 * x1[s]!;
          a += w2 * x2[s]!;
          a += w3 * x3[s]!;
          tmp[j] = a;
        }
      }
      for (; i < cin; i++) {
        const w = kro[i]!;
        const xi = x[i]!;
        for (let j = j0; j < n; j++) tmp[j]! += w * xi[base + j]!;
      }
      const outo = out[o]!;
      for (let j = j0; j < n; j++) outo[j]! += tmp[j]!;
    }
  }
  for (let o = 0; o < cout; o++) {
    const outo = out[o]!;
    const bo = b[o]!;
    for (let j = 0; j < n; j++) outo[j]! += bo;
  }
}

function tanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e2 = Math.exp(2 * x);
  return (e2 - 1) / (e2 + 1);
}

/** dst[j] = act(a[j] + b[j]) for j < n. */
function activateInto(act: Activation, a: Float64Array, b: Float64Array, dst: Float64Array, n: number): void {
  if (act.kind === 'tanh') {
    for (let j = 0; j < n; j++) dst[j] = tanh(a[j]! + b[j]!);
  } else {
    const slope = act.slope;
    for (let j = 0; j < n; j++) {
      const v = a[j]! + b[j]!;
      dst[j] = v >= 0 ? v : slope * v;
    }
  }
}

const rows = (n: number, t: number): Rows => Array.from({ length: n }, () => new Float64Array(t));
const view = (r: Rows, start: number, end: number): Rows => r.map((row) => row.subarray(start, end));

/** Calls `f(start, n)` for every block of [0, t), last block first. */
function blocksBackward(t: number, f: (start: number, n: number) => void): void {
  for (let end = t; end > 0; end -= BLOCK) {
    const start = Math.max(0, end - BLOCK);
    f(start, end - start);
  }
}

/** Runs the model over `mono` (48 kHz) and returns its output. */
export function runWavenet(mono: Float64Array, model: Wavenet): Float64Array {
  const t = mono.length;
  const cond: Rows = [mono];
  let head: Rows = [];
  let x: Rows = [mono];
  for (const la of model.arrays) {
    const ch = la.channels;
    const xx = rows(ch, t);
    blocksBackward(t, (start, n) => matmulInto(la.rechannelW, view(x, start, start + n), view(xx, start, start + n), n));
    const acc = rows(ch, t);
    for (let i = 0; i < head.length && i < acc.length; i++) acc[i]!.set(head[i]!); // 0 + h is h
    const conv = rows(ch, BLOCK);
    const mixin = rows(ch, BLOCK);
    const post = rows(ch, BLOCK);
    const ow = rows(ch, BLOCK);
    const tmp = new Float64Array(BLOCK);
    for (const layer of la.layers) {
      blocksBackward(t, (start, n) => {
        conv1dBlock(xx, layer.convW, layer.convB, layer.dilation, conv, start, n, tmp);
        matmulInto(layer.mixinW, view(cond, start, start + n), mixin, n);
        for (let c = 0; c < ch; c++) activateInto(layer.act, conv[c]!, mixin[c]!, post[c]!, n);
        for (let c = 0; c < ch; c++) {
          const ac = acc[c]!;
          const pc = post[c]!;
          for (let j = 0; j < n; j++) ac[start + j]! += pc[j]!;
        }
        matmulInto(layer.outW, post, ow, n);
        for (let c = 0; c < ch; c++) {
          const xc = xx[c]!;
          const oc = ow[c]!;
          const bc = layer.outB[c]!;
          for (let j = 0; j < n; j++) xc[start + j]! += oc[j]! + bc;
        }
      });
    }
    const headOut = rows(la.headW[0]!.length, t);
    blocksBackward(t, (start, n) => conv1dBlock(acc, la.headW, la.headB, 1, view(headOut, start, start + n), start, n, tmp));
    x = xx;
    head = headOut;
  }
  const h0 = head[0]!;
  const out = new Float64Array(t);
  for (let j = 0; j < t; j++) out[j] = model.headScale * h0[j]!;
  return out;
}
