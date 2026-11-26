/** matribox_upload_clone against the simulated unit: sources, confirm, occupied slots, the simulated-block check, the upload. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeClo } from '@pocket-master/core';
import { call, connected } from './matribox-helpers.ts';
import { fetchCapture, nodeCloneConverter, type CloneConverter } from '../src/matribox-clone.ts';
import { sectionsDi } from '../../../packages/core/test/clo-sections-di.ts';

const impulse = (n: number, gain = 1) => Float32Array.from({ length: n }, (_, i) => (i === 0 ? gain : 0));
const CLO = encodeClo({ arrayA: impulse(128), arrayB: impulse(2048), gains: [0.1, 0.1, 10, 10] });
const LOUD = encodeClo({ arrayA: impulse(128), arrayB: impulse(2048, 50), gains: [0.1, 0.1, 10, 10] });
const NAM = new URL('../../../packages/core/test/fixtures/clo/ref_input.nam', import.meta.url);

async function withFiles(convertClone?: CloneConverter) {
  const ctx = await connected({ convertClone });
  mkdirSync(ctx.nams, { recursive: true });
  writeFileSync(join(ctx.nams, 'mine.clo'), CLO);
  writeFileSync(join(ctx.nams, 'loud.clo'), LOUD);
  writeFileSync(join(ctx.nams, 'ref_input.nam'), readFileSync(NAM));
  return ctx;
}

test('a .clo from the nams folder goes to an empty slot, named after the file, and the names are read back', async () => {
  const { client, fake } = await withFiles();
  const out = await call(client, 'matribox_upload_clone', { file: 'mine.clo', slot: 9, confirm: 'clone9' });
  assert.match(out, /Wrote "mine" to CLONE 9; simulated: .* dB RMS/);
  assert.match(out, /CLONE 9: mine\n/);
  assert.match(out, /Experimental/);
  assert.equal(fake.cloneUploads.length, 1);
  assert.deepEqual(fake.cloneUploads[0]?.subarray(32), CLO);
});

test('an occupied slot is only overwritten with replace: true', async () => {
  const { client, fake } = await withFiles();
  const refused = await call(client, 'matribox_upload_clone', { file: 'mine.clo', slot: 5, confirm: 'CLONE5', name: 'OSX RECT' });
  assert.match(refused, /CLONE 5 holds "5 RECTIFIER".*replace: true/);
  assert.equal(fake.cloneUploads.length, 0);
  const out = await call(client, 'matribox_upload_clone', { file: 'mine.clo', slot: 5, confirm: 'CLONE5', name: 'OSX RECT', replace: true });
  assert.match(out, /Wrote "OSX RECT" to CLONE 5 \(replacing "5 RECTIFIER"\)/);
});

test('confirm, slot, sources, name and the simulated-block check are checked before the unit is opened', async () => {
  const { client, fake } = await withFiles();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ file: 'mine.clo', slot: 9, confirm: 'CLONE8' }, /confirm must be "CLONE9"/],
    [{ slot: 9, confirm: 'CLONE9' }, /exactly one of file, url or toneId/],
    [{ file: 'mine.clo', url: 'https://example.com/a.nam', slot: 9, confirm: 'CLONE9' }, /exactly one/],
    [{ file: '../escape.clo', slot: 9, confirm: 'CLONE9' }, /inside/],
    [{ file: 'mine.wav', slot: 9, confirm: 'CLONE9' }, /\.nam or \.clo/],
    [{ file: 'mine.clo', slot: 9, confirm: 'CLONE9', name: 'café' }, /name/],
    [{ file: 'loud.clo', slot: 9, confirm: 'CLONE9' }, /far too loud in the simulated CLONE block/],
    [{ file: 'ref_input.nam', slot: 9, confirm: 'CLONE9' }, /cannot convert \.nam/],
    [{ url: 'http://example.com/a.nam', slot: 9, confirm: 'CLONE9' }, /https/],
  ];
  for (const [args, error] of cases) assert.match(await call(client, 'matribox_upload_clone', args), error);
  assert.match(await call(client, 'matribox_upload_clone', { file: 'mine.clo', slot: 11, confirm: 'CLONE11' }), /10|slot/);
  assert.equal(fake.received.length, 0);
});

test('a .nam is converted in a worker thread, checked and uploaded', { timeout: 300_000 }, async () => {
  const progress: number[] = [];
  const convert = nodeCloneConverter(async () => Float32Array.from(sectionsDi(44100)));
  const { client, fake } = await withFiles((nam) =>
    convert(nam, (f) => {
      progress.push(f);
    }),
  );
  const out = await call(client, 'matribox_upload_clone', { file: 'ref_input.nam', slot: 7, confirm: 'CLONE7', name: 'Ref input' });
  assert.match(out, /Wrote "Ref input" to CLONE 7/);
  assert.equal(fake.cloneUploads.length, 1);
  assert.equal(progress.at(-1), 1);
});

test('fetchCapture downloads https links only, and reports HTTP errors', async () => {
  const ok = (async () => new Response(CLO)) as unknown as typeof fetch;
  assert.deepEqual(await fetchCapture('https://example.com/a.clo', ok), CLO);
  const missing = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(fetchCapture('https://example.com/a.clo', missing), /HTTP 404/);
  await assert.rejects(fetchCapture('file:///etc/passwd', ok), /https/);
  await assert.rejects(fetchCapture('nope', ok), /not a link/);
});
