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

test('the worker checks a .clo through the simulated CLONE block', async () => {
  const { encodeClo } = await import('@pocket-master/core');
  const sent: { msg: { ok: boolean; check?: { ok: boolean; problem?: string } } }[] = [];
  Object.assign(globalThis, { self: { ...(globalThis as unknown as { self: object }).self, postMessage: (msg: never) => void sent.push({ msg }) } });
  await import('../lib/convert.worker.ts');
  const impulse = (n: number) => Float32Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));
  const clo = encodeClo({ arrayA: impulse(128), arrayB: impulse(2048), gains: [0.1, 0.1, 10, 10] });
  (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => void } }).self.onmessage({ data: { kind: 'check', clo } });
  assert.equal(sent.at(-1)!.msg.ok, true);
  assert.equal(sent.at(-1)!.msg.check!.ok, true);
});
