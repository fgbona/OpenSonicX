import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Activation, Wavenet, WavenetLayerArray } from '../src/clo/nam.ts';
import { runWavenet } from '../src/clo/wavenet.ts';

let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
  return (seed / 4294967296) * 2 - 1;
};
const vec = (n: number, scale = 0.4) => Float64Array.from({ length: n }, () => rand() * scale);
const mat = (r: number, c: number) => Array.from({ length: r }, () => vec(c));

function layerArray(input: number, ch: number, headOut: number, dilations: number[], act: Activation): WavenetLayerArray {
  return {
    channels: ch,
    rechannelW: mat(ch, input),
    layers: dilations.map((dilation) => ({ convW: [mat(ch, ch), mat(ch, ch), mat(ch, ch)], convB: vec(ch), mixinW: mat(ch, 1), outW: mat(ch, ch), outB: vec(ch), dilation, act })),
    headW: [mat(headOut, ch)],
    headB: vec(headOut),
  };
}

/** The plain per-sample definition, every sum in the reference order. */
function naive(mono: Float64Array, model: Wavenet): Float64Array {
  const t = mono.length;
  const mul = (m: readonly Float64Array[], x: Float64Array[]) => m.map((row) => Float64Array.from({ length: t }, (_, j) => row.reduce((s, w, i) => s + w * x[i]![j]!, 0)));
  const conv = (x: Float64Array[], k: readonly (readonly Float64Array[])[], b: Float64Array, dil: number) =>
    k[0]!.map((_, o) => Float64Array.from({ length: t }, (_, j) => {
      let s = 0;
      k.forEach((tap, ki) => {
        const src = j - dil * (k.length - 1 - ki);
        if (src >= 0) s += tap[o]!.reduce((a, w, i) => a + w * x[i]![src]!, 0);
      });
      return s + b[o]!;
    }));
  let x = [mono];
  let head: Float64Array[] = [];
  for (const la of model.arrays) {
    const xx = mul(la.rechannelW, x);
    const acc = xx.map((_, c) => Float64Array.from({ length: t }, (_, j) => 0 + (head[c]?.[j] ?? 0)));
    for (const l of la.layers) {
      const cv = conv(xx, l.convW, l.convB, l.dilation);
      const mx = mul(l.mixinW, [mono]);
      const post = cv.map((r, c) => r.map((v, j) => {
        const z = v + mx[c]![j]!;
        if (l.act.kind === 'leaky') return z >= 0 ? z : l.act.slope * z;
        return z > 20 ? 1 : z < -20 ? -1 : (Math.exp(2 * z) - 1) / (Math.exp(2 * z) + 1);
      }));
      post.forEach((r, c) => r.forEach((v, j) => (acc[c]![j]! += v)));
      mul(l.outW, post).forEach((r, c) => r.forEach((v, j) => (xx[c]![j]! += v + l.outB[c]!)));
    }
    head = conv(acc, la.headW, la.headB, 1);
    x = xx;
  }
  return head[0]!.map((v) => model.headScale * v);
}

test('the blocked WaveNet pass equals the per-sample definition bit for bit', () => {
  // 5 channels hit both the 4-wide and the leftover channel loops; dilation 1500 reaches two
  // blocks back; 5000 samples leave a partial block.
  const model: Wavenet = {
    arrays: [layerArray(1, 5, 3, [1, 7, 1500], { kind: 'tanh' }), layerArray(5, 3, 1, [2, 300], { kind: 'leaky', slope: 0.05 })],
    headScale: 0.5,
  };
  const mono = vec(5000, 0.8);
  const got = runWavenet(mono, model);
  const want = naive(mono, model);
  for (let j = 0; j < mono.length; j++) assert.equal(got[j], want[j], `sample ${j}`);
});
