import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateClo } from '../src/clo/generate.ts';
import { syntheticDi } from '../src/clo/synthetic-di.ts';

const fixture = (name: string) => new URL(`./fixtures/clo/${name}`, import.meta.url);

/** SonicMaster's own Dart DSP output for the same .nam and synthetic DI (see the golden generator). */
function golden(name: string) {
  const bytes = readFileSync(fixture(`${name}.golden.f32`));
  const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return { arrayA: f.subarray(0, 128), arrayB: f.subarray(128, 2176), gains: f.subarray(2176, 2180) };
}

const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0);

for (const name of ['ref_input', 'synthetic_v070']) {
  test(`the TypeScript converter matches SonicMaster's DSP on ${name}.nam`, { timeout: 300_000 }, () => {
    const want = golden(name);
    const got = generateClo(readFileSync(fixture(`${name}.nam`), 'utf8'), syntheticDi());
    assert.equal(got.arrayA.length, 128);
    assert.equal(got.arrayB.length, 2048);
    for (const key of ['arrayA', 'arrayB', 'gains'] as const) {
      const diff = maxAbsDiff(got[key], want[key]);
      const sumDiff = Math.abs(sum(got[key]) - sum(want[key]));
      assert.ok(diff < 1e-3, `${key}: max element difference ${diff}`);
      assert.ok(sumDiff < 1e-3, `${key}: sum difference ${sumDiff}`);
    }
  });
}
