import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syntheticDi } from '@pocket-master/core';
import { nodeConverter } from '../src/convert.ts';

const fixtures = new URL('../../../packages/core/test/fixtures/clo/', import.meta.url);

test('the parallel Node converter gives the same arrays as SonicMaster on the synthetic DI', { timeout: 120_000, skip: process.env.SKIP_CLO_PARITY ? 'converter unchanged (runs in the Converter parity workflow)' : false }, async () => {
  const convert = nodeConverter('/nonexistent', async () => syntheticDi());
  const progress: number[] = [];
  const got = await convert(readFileSync(new URL('ref_input.nam', fixtures), 'utf8'), (done) => progress.push(done));
  const b = readFileSync(new URL('ref_input.golden.f32', fixtures));
  const want = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  assert.deepEqual([...got.arrayA], [...want.subarray(0, 128)]);
  assert.deepEqual([...got.arrayB], [...want.subarray(128, 2176)]);
  assert.deepEqual([...got.gains], [...want.subarray(2176, 2180)]);
  assert.deepEqual(progress, [1, 2, 3, 4, 5]);
});

test('an unsupported capture is refused before anything is downloaded', async () => {
  let loaded = false;
  const convert = nodeConverter('/nonexistent', async () => { loaded = true; return syntheticDi(); });
  await assert.rejects(convert(JSON.stringify({ architecture: 'LSTM', config: {}, weights: [] })), /only WaveNet/);
  assert.equal(loaded, false);
});
