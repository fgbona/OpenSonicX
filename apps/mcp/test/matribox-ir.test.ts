/** matribox_load_ir against the simulated unit: path, confirm and occupied-slot checks, the upload, the ack. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { joinMbPages, mbIrUpload, mbIrUploadData, parseMbFrame, toHex, unwrapMbMessage } from '@pocket-master/core';
import { fakeLink, call, connected } from './matribox-helpers.ts';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { uploadMatriboxIr } from '../src/matribox-ir.ts';

const IMPULSE = new URL('../../../packages/core/test/fixtures/matribox-ir/teste-impulso.wav', import.meta.url);
const WAV = new Uint8Array(readFileSync(IMPULSE));

async function withIr() {
  const ctx = await connected();
  mkdirSync(ctx.irs, { recursive: true });
  copyFileSync(IMPULSE, join(ctx.irs, 'teste-impulso.wav'));
  return ctx;
}

test('matribox_load_ir uploads the WAV into an empty slot and reads the names back', async () => {
  const { client, fake } = await withIr();
  const out = await call(client, 'matribox_load_ir', { file: 'teste-impulso.wav', slot: 8, confirm: 'ir8' });
  assert.match(out, /Loaded "teste-impulso" into User IR 8\./);
  assert.match(out, /Experimental/);
  assert.match(out, /User IR 8: teste-impulso\n/);
  assert.equal(fake.irUploads.length, 1);
  assert.equal(toHex(fake.irUploads[0] as Uint8Array), toHex(mbIrUploadData(7, 'teste-impulso', WAV)));
});

test('matribox_load_ir refuses an occupied slot unless replace is true, and names it', async () => {
  const { client, fake } = await withIr();
  const refused = await call(client, 'matribox_load_ir', { file: 'teste-impulso.wav', slot: 1, confirm: 'IR1', name: 'Mine' });
  assert.match(refused, /User IR 1 holds "Marshall War30s".*replace: true/);
  assert.equal(fake.irUploads.length, 0);
  const out = await call(client, 'matribox_load_ir', { file: 'teste-impulso.wav', slot: 1, confirm: 'IR1', name: 'Mine', replace: true });
  assert.match(out, /Loaded "Mine" into User IR 1 \(replacing "Marshall War30s"\)/);
});

test('matribox_load_ir checks confirm, the slot, the path and the file before opening the unit', async () => {
  const { client, fake, irs } = await withIr();
  writeFileSync(join(irs, 'not-a.wav'), 'nope');
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ file: 'teste-impulso.wav', slot: 8, confirm: 'IR7' }, /confirm must be "IR8"/],
    [{ file: '../escape.wav', slot: 8, confirm: 'IR8' }, /inside/],
    [{ file: 'teste-impulso.txt', slot: 8, confirm: 'IR8' }, /\.wav/],
    [{ file: 'not-a.wav', slot: 8, confirm: 'IR8' }, /WAV/],
    [{ file: 'teste-impulso.wav', slot: 8, confirm: 'IR8', name: 'café' }, /name/],
  ];
  for (const [args, error] of cases) assert.match(await call(client, 'matribox_load_ir', args), error);
  assert.match(await call(client, 'matribox_load_ir', { file: 'teste-impulso.wav', slot: 21, confirm: 'IR21' }), /20|slot/);
  assert.equal(fake.received.length, 0);
});

test('an upload the unit refuses (status 0) is reported, and the slot is left alone', async () => {
  const fake = new FakeMatribox();
  fake.irStatus = 0;
  const unit = { ...fakeLink(fake), close: () => undefined };
  await assert.rejects(uploadMatriboxIr(unit, 9, { frames: mbIrUpload(8, 'x', WAV), name: 'x' }), /did not store the IR in User IR 9 \(status 0\)/);
});

test('the link sends the upload as 23 pages and waits for the flag-3 acknowledgement', async () => {
  const fake = new FakeMatribox();
  const ack = await fakeLink(fake).upload(mbIrUpload(4, 'x', WAV));
  assert.equal(toHex(ack), '04 00 00 00 01 00 00 00 00 00 00 00');
  const pages = fake.received.map((h) => parseMbFrame(Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)))));
  assert.equal(pages.length, 23);
  assert.equal(unwrapMbMessage(joinMbPages(pages) as Uint8Array).cmd, 0x14);
  fake.echoes = false;
  await assert.rejects(fakeLink(fake, 50).upload(mbIrUpload(4, 'x', WAV)), /did not acknowledge the upload/);
});
