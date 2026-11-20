import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceDiAt48 } from '@pocket-master/core';

test('the worker resamples the reference DI and hands the result back by transfer', async () => {
  const sent: { msg: { ok: boolean; di48?: Float64Array }; transfer?: Transferable[] }[] = [];
  Object.assign(globalThis, { self: { postMessage: (msg: never, transfer?: Transferable[]) => void sent.push({ msg, transfer }) } });
  await import('../lib/convert.worker.ts');
  const di = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 7));
  (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => void } }).self.onmessage({ data: { kind: 'resample', di } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.msg.ok, true);
  assert.deepEqual(sent[0]!.msg.di48, referenceDiAt48(di));
  assert.deepEqual(sent[0]!.transfer, [sent[0]!.msg.di48!.buffer]);
});
