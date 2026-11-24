import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakePedal } from '../../../packages/core/test/fake-pedal.ts';
import { Session, type PedalIO } from '../src/session.ts';
import { createServer } from '../src/tools.ts';
import { shape, type Schema } from '../../../packages/core/test/schema-shape.ts';

async function connected() {
  const fake = new FakePedal({}, 8);
  const io: PedalIO = Object.assign(fake, { readSlotNames: async () => ({ irNames: null, profileNames: null }), readModified: async () => null, uploadIr: async () => undefined, uploadProfile: async () => undefined, renameSlot: async () => undefined, readGlobals: async () => GLOBALS, writeGlobals: async () => undefined, copyPreset: async () => undefined, setTuner: async () => undefined, clearSlot: async () => undefined });
  const dir = mkdtempSync(join(tmpdir(), 'pm-tools-'));
  const session = new Session(() => ({ io, close: () => undefined }), { backups: join(dir, 'b'), presets: join(dir, 'p'), irs: join(dir, 'i'), nams: join(dir, 'n') });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([createServer(session).connect(a), client.connect(b)]);
  return { client, fake };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join('\n');

const GLOBALS = { masterVolume: 80, inputLevel: -3, fxRecLevel: 2, monitorLevel: 0, btRecLevel: 0, backlight: 6, mode: 1, bootProtection: 1, reamp: 0, eco: 0, expFsType: 1 } as const;

test('the server lists every tool, marking reads read-only and slot writes destructive', async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), [
    'backup_all_presets', 'copy_preset', 'delete_slot', 'edit_preset', 'export_preset', 'get_global_settings', 'get_preset', 'import_preset', 'install_tone', 'list_models', 'list_preset_files', 'list_presets',
    'load_ir', 'load_nam', 'matribox_get_preset', 'matribox_list_captures', 'matribox_list_irs', 'matribox_list_models', 'matribox_list_presets', 'rename_slot', 'restore_backup', 'revert_preset', 'save_preset', 'search_tone3000', 'select_preset', 'set_global_settings', 'set_tuner', 'tone3000_login', 'undo_edit', 'which_pedal',
  ]);
  for (const name of ['get_preset', 'list_presets', 'list_models', 'backup_all_presets']) assert.equal(byName[name]!.annotations?.readOnlyHint, true, name);
  for (const name of ['save_preset', 'restore_backup', 'load_ir', 'load_nam', 'install_tone', 'copy_preset', 'delete_slot']) assert.equal(byName[name]!.annotations?.destructiveHint, true, name);
  assert.equal(byName['edit_preset']!.annotations?.destructiveHint, false);
});

test('get_preset returns the preset as text', async () => {
  const { client, fake } = await connected();
  const result = await client.callTool({ name: 'get_preset', arguments: {} });
  assert.match(text(result), new RegExp(`^P09 "${fake.names[8]}"`));
});

test('edit_preset changes the pedal and a bad name comes back as a readable tool error', async () => {
  const { client, fake } = await connected();
  const ok = await client.callTool({ name: 'edit_preset', arguments: { changes: [{ kind: 'parameter', block: 'AMP', parameter: 'Gain', value: 66 }] } });
  assert.match(text(ok), /Gain 66/);
  const before = fake.received.length;
  const bad = await client.callTool({ name: 'edit_preset', arguments: { changes: [{ kind: 'block', block: 'WAH', on: true }] } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /No block "WAH"\. Blocks: /);
  assert.equal(fake.received.length, before);
});

test('save_preset cannot be called without confirm', async () => {
  const { client, fake } = await connected();
  const result = await client.callTool({ name: 'save_preset', arguments: { slot: 'P03', name: 'X' } });
  assert.equal(result.isError, true);
  assert.equal(fake.received.some((r) => r.startsWith('save')), false);
});

test('list_models works without a block', async () => {
  const { client } = await connected();
  const result = await client.callTool({ name: 'list_models', arguments: {} });
  assert.match(text(result), /AMP models:[\s\S]*Calif DualM: based on Mesa\/Boogie/);
});

test('every tool call reports how long it took on the pedal', async () => {
  const fake = new FakePedal({}, 8);
  const io: PedalIO = Object.assign(fake, { readSlotNames: async () => ({ irNames: null, profileNames: null }), readModified: async () => null, uploadIr: async () => undefined, uploadProfile: async () => undefined, renameSlot: async () => undefined, readGlobals: async () => GLOBALS, writeGlobals: async () => undefined, copyPreset: async () => undefined, setTuner: async () => undefined, clearSlot: async () => undefined });
  const dir = mkdtempSync(join(tmpdir(), 'pm-timing-'));
  const session = new Session(() => ({ io, close: () => undefined }), { backups: join(dir, 'b'), presets: join(dir, 'p'), irs: join(dir, 'i'), nams: join(dir, 'n') });
  const timings: { tool: string; ms: number; ok: boolean }[] = [];
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([createServer(session, { onTiming: (t) => void timings.push(t) }).connect(a), client.connect(b)]);
  await client.callTool({ name: 'get_preset', arguments: {} });
  await client.callTool({ name: 'edit_preset', arguments: { changes: [{ kind: 'block', block: 'WAH', on: true }] } });
  await client.callTool({ name: 'import_preset', arguments: { file: 'missing.json' } });
  assert.deepEqual(timings.map((t) => [t.tool, t.ok]), [['get_preset', true], ['edit_preset', false], ['import_preset', false]]);
  assert.ok(timings.every((t) => Number.isFinite(t.ms) && t.ms >= 0));
});

test('list_preset_files is a read-only tool', async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  assert.equal(tools.find((t) => t.name === 'list_preset_files')?.annotations?.readOnlyHint, true);
});

// The tool contract assistants are configured against is frozen for 1.x. A change that fails here
// is deliberate: rerun with UPDATE_MCP_CONTRACT=1, and record it in the changelog (a removed or
// renamed tool or parameter, or a new required one, is a breaking change).
test('the tool contract (names, parameters, types) is unchanged', async () => {
  const { client } = await connected();
  const { tools } = await client.listTools();
  const contract = Object.fromEntries(tools.map((t) => [t.name, shape(t.inputSchema as Schema)]).sort(([a], [b]) => a!.localeCompare(b!)));
  const file = new URL('./fixtures/tool-contract.json', import.meta.url);
  if (process.env.UPDATE_MCP_CONTRACT) writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
  assert.deepEqual(contract, JSON.parse(readFileSync(file, 'utf8')));
});
