import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mbReadCloneNames, mbReadPresetNames, mbRequest, parseMbPresetNames } from '@pocket-master/core';
import { FakeMatribox } from './fake-matribox.ts';
import { call, connected, fakeLink, text } from './matribox-helpers.ts';
import { describePedals, detectPedals, MATRIBOX, POCKET_MASTER } from '../src/devices.ts';
import { Session, type PedalIO } from '../src/session.ts';
import { createServer } from '../src/tools.ts';

test('the link joins a paged reply, skips unrelated notifications and returns the decompressed data', async () => {
  const data = await fakeLink().read(mbReadPresetNames());
  assert.equal(data.length, 7444);
  assert.equal(parseMbPresetNames(data)[66]?.name, 'Drive AD');
});

test('the link times out with a clear error when the unit does not answer', async () => {
  await assert.rejects(fakeLink(new FakeMatribox(), 50).read(mbRequest(0, 0x13)), /Matribox II PRO did not answer.*cmd 0x13/);
});

test('the link refuses a request that is not a read', async () => {
  await assert.rejects(fakeLink().read(Uint8Array.from([0xf0, 0x7e, 0xf7])), /Matribox/);
});

test('detects which supported pedals are connected from the MIDI port names', () => {
  assert.deepEqual(detectPedals(['IAC Bus 1', 'Matribox II PRO']).map((p) => p.device), [MATRIBOX]);
  assert.deepEqual(detectPedals(['Pocket Master', 'Matribox II PRO']).map((p) => p.device), [POCKET_MASTER, MATRIBOX]);
  assert.match(describePedals(['Matribox II PRO']), /Matribox II Pro on MIDI port "Matribox II PRO": use the matribox_ tools/);
  assert.match(describePedals(['IAC Bus 1']), /No supported pedal is connected \(MIDI ports: IAC Bus 1\)/);
});

test('the Matribox tools and which_pedal are read-only', async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  for (const name of ['which_pedal', 'matribox_list_presets', 'matribox_get_preset', 'matribox_list_models', 'matribox_list_irs', 'matribox_list_captures']) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, true, name);
    assert.equal(tool?.annotations?.destructiveHint, false, name);
  }
});

test('which_pedal reports the connected pedal', async () => {
  const { client } = await connected({ ports: ['Matribox II PRO'] });
  assert.match(await call(client, 'which_pedal'), /^Sonicake Matribox II Pro on MIDI port "Matribox II PRO"/);
});

test('matribox_list_presets lists the 240 presets with bank labels and marks the loaded one', async () => {
  const { client, fake } = await connected();
  const out = await call(client, 'matribox_list_presets');
  const lines = out.split('\n');
  assert.equal(lines[0], 'Loaded: 17C "Drive AD"');
  assert.equal(lines.filter((l) => /^ ?[* ] *\d+[A-D] /.test(l)).length, 240);
  assert.match(out, /^ {2}1A {2}Matribox II PRO \(Rock\)$/m);
  assert.match(out, /^\* 17C {1}Drive AD \(Rock\)$/m);
  assert.match(out, /^ {2}60D /m);
  assert.ok(fake.received.length === 2, 'only the two reads');
});

test('matribox_get_preset describes the loaded preset: chain, models with origin, on/off, named params', async () => {
  const { client } = await connected();
  const out = await call(client, 'matribox_get_preset');
  const lines = out.split('\n');
  assert.equal(lines[0], '17C "Drive AD" · style Rock');
  assert.equal(lines[1], 'Chain: DYN → DRV → AMP → CAB → RVB → VOL');
  assert.match(out, /^1\. DYN {2}on {3}Fake Gate \(based on Imaginary Gate Alias: Gate X\): Threshold [-\d.]+ \[-80\.\.0\]$/m);
  assert.match(out, /^2\. DRV {2}off {2}Fake Drive \(based on Imaginary Overdrive 808\): Gain 15 \[0\.\.100\], Tone 50 \[0\.\.100\], Volume 14 \[0\.\.100\]$/m);
  assert.match(out, /^4\. CAB {2}on {3}unknown model \(fxid 0x0a000006\)$/m);
  assert.match(out, /^6\. VOL {2}on {3}Volume \(based on Volume\): Volume /m);
});

test('matribox_list_models gives the palette: models with origin and parameter ranges, optionally one module', async () => {
  const { client } = await connected();
  const all = await call(client, 'matribox_list_models');
  assert.match(all, /^DRV models:\n- Fake Drive: based on Imaginary Overdrive 808\. A mid-boost overdrive\.\n {4}params: Gain 0\.\.100, Tone 0\.\.100, Volume 0\.\.100$/m);
  const amp = await call(client, 'matribox_list_models', { module: 'amp' });
  assert.match(amp, /^AMP models:\n- Fake Plexi: based on Imaginary Plexi 50W\.\n {4}params: Gain 0\.\.100, Master 0\.\.100$/);
  assert.match(all, /^- Fake 4x12\n {4}params: Volume 0\.\.100$/m); // a bare number is no gear name
  const bad = await client.callTool({ name: 'matribox_list_models', arguments: { module: 'XYZ' } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /No module "XYZ"\. Modules: DYN, DRV, AMP, CAB, IR, DLY, RVB, CLONE, VOL/);
});

test('matribox_list_models explains how to get the catalog when the official app is missing', async () => {
  const { client } = await connected({ catalog: async () => { throw new Error('Matribox II PRO catalog not found at /x: install it'); } });
  const result = await client.callTool({ name: 'matribox_list_models', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(text(result), /catalog not found/);
});

test('matribox_list_irs and matribox_list_captures read the slot names', async () => {
  const { client, fake } = await connected();
  assert.match(await call(client, 'matribox_list_irs'), /^User IR 1: Marshall War30s\nUser IR 2: V30UK SM57\n/);
  const captures = await call(client, 'matribox_list_captures');
  assert.match(captures, /^Capture 1: 1 FENDER\n/);
  assert.equal(captures.split('\n').length, 10);
  assert.ok(fake.received.includes(Buffer.from(mbReadCloneNames()).toString('hex')));
});

test('Matribox tools without a Matribox session fail with a readable error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mb-none-'));
  const io = {} as PedalIO;
  const pocketMaster = new Session(() => ({ io, close: () => undefined }), { backups: join(dir, 'b'), presets: join(dir, 'p'), irs: join(dir, 'i'), nams: join(dir, 'n') });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([createServer(pocketMaster).connect(a), client.connect(b)]);
  const result = await client.callTool({ name: 'matribox_get_preset', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(text(result), /Matribox/);
});
