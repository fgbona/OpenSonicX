import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromHex, MB_WRITE, parseMbFrame, parseMbPreset } from '@pocket-master/core';
import { call, connected, text } from './matribox-helpers.ts';

const WRITE_TOOLS = ['matribox_set_param', 'matribox_set_module_on', 'matribox_select_preset', 'matribox_set_model', 'matribox_build_tone', 'matribox_save_preset'];
const EXPERIMENTAL = /Experimental: .*not validated on the hardware/;
/** How many write frames the simulated unit received. */
const writes = (fake: { received: string[] }) => fake.received.filter((hex) => parseMbFrame(fromHex(hex)).type === MB_WRITE).length;

test('the Matribox write tools are listed as writes; only save_preset is destructive', async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  for (const name of WRITE_TOOLS) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, false, name);
    assert.equal(tool?.annotations?.destructiveHint, name === 'matribox_save_preset', name);
    assert.match(tool?.description ?? '', /experimental/i, name);
  }
  assert.match(tools.find((t) => t.name === 'matribox_build_tone')?.description ?? '', /origin/);
});

test('matribox_set_param sets a parameter by name on a block named by module or position', async () => {
  const { client } = await connected();
  const out = await call(client, 'matribox_set_param', { block: 'drv', parameter: 'gain', value: 60 });
  assert.match(out, /^DRV Fake Drive: Gain 15 → 60$/m);
  assert.match(out, EXPERIMENTAL);
  await call(client, 'matribox_set_param', { block: '2', parameter: 'Tone', value: 72.5 });
  assert.match(await call(client, 'matribox_get_preset'), /^2\. DRV {2}off {2}Fake Drive .*: Gain 60 \[0\.\.100\], Tone 72\.5 \[0\.\.100\]/m);
});

test('matribox_set_param refuses an unknown block or parameter and a value out of range, sending nothing', async () => {
  const { client, fake } = await connected();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ block: 'DLY', parameter: 'Mix', value: 1 }, /No block "DLY"\. Chain: 1 DYN, 2 DRV, 3 AMP, 4 CAB, 5 RVB, 6 VOL/],
    [{ block: '9', parameter: 'Mix', value: 1 }, /No block "9"/],
    [{ block: 'DRV', parameter: 'Drive', value: 1 }, /Fake Drive has no parameter "Drive"\. Parameters: Gain, Tone, Volume/],
    [{ block: 'DRV', parameter: 'Gain', value: 101 }, /Gain must be 0\.\.100, got 101/],
    [{ block: 'CAB', parameter: 'Volume', value: 1 }, /unknown model/],
  ];
  for (const [args, message] of cases) {
    const result = await client.callTool({ name: 'matribox_set_param', arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(text(result), message);
  }
  assert.equal(writes(fake), 0);
});

test('matribox_set_module_on turns a block on or off', async () => {
  const { client } = await connected();
  const out = await call(client, 'matribox_set_module_on', { block: 'DRV', on: true });
  assert.match(out, /^DRV Fake Drive: on$/m);
  assert.match(out, EXPERIMENTAL);
  assert.match(await call(client, 'matribox_get_preset'), /^2\. DRV {2}on {3}Fake Drive/m);
});

test('matribox_select_preset loads a preset by label', async () => {
  const { client, fake } = await connected();
  const out = await call(client, 'matribox_select_preset', { preset: '60d' });
  assert.match(out, /^Loaded 60D\.$/m);
  assert.match(out, EXPERIMENTAL);
  assert.equal(fake.current, 239);
  assert.match(await call(client, 'matribox_list_presets'), /^Loaded: 60D /);
  const bad = await client.callTool({ name: 'matribox_select_preset', arguments: { preset: '61A' } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /1A\.\.60D/);
});

test('matribox_set_model swaps the model in a block and writes the new model\'s defaults', async () => {
  const { client } = await connected();
  const out = await call(client, 'matribox_set_model', { block: 'DRV', model: 'fake fuzz' });
  assert.match(out, /^DRV: Fake Drive → Fake Fuzz \(based on Imaginary Fuzz Face\): Fuzz 0, Level 0$/m);
  assert.match(out, EXPERIMENTAL);
  const preset = await call(client, 'matribox_get_preset');
  assert.match(preset, /^Chain: DYN → DRV → AMP → CAB → RVB → VOL$/m);
  assert.match(preset, /^2\. DRV {2}off {2}Fake Fuzz \(based on Imaginary Fuzz Face\): Fuzz 0 \[0\.\.100\], Level 0 \[0\.\.100\]$/m);
  const bad = await client.callTool({ name: 'matribox_set_model', arguments: { block: 'DRV', model: 'Nope' } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /No model "Nope"/);
});

test('matribox_build_tone builds a whole chain in one call, with defaults for parameters not given', async () => {
  const { client, fake } = await connected();
  const out = await call(client, 'matribox_build_tone', {
    blocks: [
      { module: 'drv', model: 'Fake Drive', params: { Gain: 70 } },
      { module: 'AMP', model: 'Fake Plexi', params: { gain: 55, Master: 40 } },
      { module: 'DLY', model: 'Fake Echo', on: false, params: { Time: 400 } },
    ],
  });
  assert.match(out, /^Chain: DRV → AMP → DLY$/m);
  assert.match(out, /^1\. DRV on {2}Fake Drive \(based on Imaginary Overdrive 808\): Gain 70, Tone 0, Volume 0$/m);
  assert.match(out, /^3\. DLY off Fake Echo \(based on Imaginary Tape Echo\): Mix 0, Time 400$/m);
  assert.match(out, EXPERIMENTAL);
  const preset = await call(client, 'matribox_get_preset');
  assert.match(preset, /^Chain: DRV → AMP → DLY$/m);
  assert.match(preset, /^2\. AMP {2}on {3}Fake Plexi .*: Gain 55 \[0\.\.100\], Master 40 \[0\.\.100\]$/m);
  assert.match(preset, /^3\. DLY {2}off {2}Fake Echo .*: Mix 0 \[0\.\.100\], Time 400 \[20\.\.2000\]$/m);
  // assignments + chain + one write per parameter (3 + 2 + 2)
  assert.equal(writes(fake), 9);
});

test('matribox_build_tone validates everything before sending anything', async () => {
  const { client, fake } = await connected();
  const block = { module: 'DRV', model: 'Fake Drive' };
  const cases: [unknown[], RegExp][] = [
    [[{ module: 'XYZ', model: 'Fake Drive' }], /No module "XYZ"/],
    [[{ module: 'AMP', model: 'Fake Drive' }], /No AMP model "Fake Drive"/],
    [[{ ...block, params: { Gain: -1 } }], /Gain must be 0\.\.100, got -1/],
    [[{ ...block, params: { Fuzz: 1 } }], /no parameter "Fuzz"/],
    [Array(13).fill(block), /at most 12 blocks/],
  ];
  for (const [blocks, message] of cases) {
    const result = await client.callTool({ name: 'matribox_build_tone', arguments: { blocks } });
    assert.equal(result.isError, true, message.source);
    assert.match(text(result), message);
  }
  assert.equal(writes(fake), 0);
});

test('matribox_save_preset needs confirm with the slot label and backs the slot up first', async () => {
  const { client, fake, backups } = await connected();
  await call(client, 'matribox_set_param', { block: 'DRV', parameter: 'Gain', value: 61 });
  const wrong = await client.callTool({ name: 'matribox_save_preset', arguments: { preset: '17C', name: 'My Tone', confirm: '17D' } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /confirm must be "17C"/);
  assert.equal(writes(fake), 1);
  const badName = await client.callTool({ name: 'matribox_save_preset', arguments: { preset: '17C', name: 'Ünïcode', confirm: '17C' } });
  assert.match(text(badName), /printable ASCII/);

  const out = await call(client, 'matribox_save_preset', { preset: '17c', name: 'My Tone', confirm: '17c' });
  assert.match(out, /^Saved the loaded preset to 17C "My Tone"\.$/m);
  assert.match(out, EXPERIMENTAL);
  const [file] = readdirSync(backups);
  assert.ok(file?.endsWith('-matribox-17C.json'), String(file));
  assert.ok(out.includes(join(backups, file as string)));
  const backup = JSON.parse(readFileSync(join(backups, file as string), 'utf8')) as { device: string; label: string; index: number; name: string; preset: string };
  assert.equal(backup.device, 'Sonicake Matribox II Pro');
  assert.deepEqual([backup.label, backup.index, backup.name], ['17C', 66, 'Drive AD']);
  assert.equal(parseMbPreset(fromHex(backup.preset)).name, 'Drive AD');
  assert.match(await call(client, 'matribox_list_presets'), /^\* 17C {1}My Tone \(Rock\)$/m);
  assert.equal(parseMbPreset(fake.stored(66) as Uint8Array).name, 'My Tone');
});

test('a write the unit does not echo fails with a clear error', async () => {
  const { client, fake } = await connected();
  fake.echoes = false;
  const result = await client.callTool({ name: 'matribox_set_module_on', arguments: { block: 'DRV', on: true } });
  assert.equal(result.isError, true);
  assert.match(text(result), /did not confirm the write/);
});
