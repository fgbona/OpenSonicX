import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_INSTRUCTIONS, CHAT_TOOLS, chatContext, runChatTool, type ToneHost } from '../src/assistant/chat.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { applyEdit, type Edit } from '../src/edit.ts';
import { realP08 } from './fake-pedal.ts';
import { shape, type Schema } from './schema-shape.ts';

const SLOTS = { irNames: ['Mesa OS', null, null, null, null], profileNames: ['Randall SA', null, null, null, null] };

/** The editor as the chat sees it: P08 loaded, every call recorded. */
function fakeHost(options: { select?: boolean; save?: 'saved' | 'cancelled'; refuseEdits?: string } = {}) {
  const calls: string[] = [];
  let preset: Preset = decodePreset(realP08());
  const history: Preset[] = [];
  const host: ToneHost = {
    snapshot: () => ({ index: 7, name: 'IRON-RHY', preset, slots: SLOTS, modified: history.length > 0, names: Array.from({ length: 100 }, (_, i) => `NAME ${i + 1}`) }),
    async applyEdits(edits: readonly Edit[]) {
      if (options.refuseEdits) throw new Error(options.refuseEdits);
      calls.push(`edits ${edits.map((e) => e.kind).join(',')}`);
      history.push(preset);
      preset = edits.reduce(applyEdit, preset);
    },
    async undo() { calls.push('undo'); const last = history.pop(); if (!last) return false; preset = last; return true; },
    async revert() { calls.push('revert'); preset = history[0] ?? preset; history.length = 0; },
    async selectPreset(index) { calls.push(`select ${index}`); return options.select ?? true; },
    async proposeSave(index, name) { calls.push(`propose ${index} ${name}`); return options.save ?? 'saved'; },
  };
  return { host, calls };
}

test('edit_preset applies every change at once and answers with the preset as it is now', async () => {
  const { host, calls } = fakeHost();
  const r = await runChatTool(host, 'edit_preset', { changes: [{ kind: 'model', block: 'amp', model: 'Calif DualM' }, { kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['edits model,param']);
  assert.match(r.text, /AMP +on +Calif DualM: Gain 70/);
});

test('a bad change list sends nothing, and says what was wrong', async () => {
  const { host, calls } = fakeHost();
  const r = await runChatTool(host, 'edit_preset', { changes: [{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }, { kind: 'model', block: 'amp', model: 'No Such Amp' }] });
  assert.equal(r.ok, false);
  assert.match(r.text, /No Such Amp/i);
  assert.deepEqual(calls, []);
});

test('the editor refusing an edit (live edit off) comes back as a tool error', async () => {
  const { host } = fakeHost({ refuseEdits: 'Live edit is off: the person must turn it on.' });
  const r = await runChatTool(host, 'edit_preset', { changes: [{ kind: 'volume', value: 50 }] });
  assert.deepEqual(r, { ok: false, text: 'Error: Live edit is off: the person must turn it on.' });
});

test('save_preset only proposes: the editor\'s dialog decides', async () => {
  const saved = fakeHost();
  assert.equal((await runChatTool(saved.host, 'save_preset', { slot: 'P45', name: 'BLACK ALB' })).ok, true);
  assert.deepEqual(saved.calls, ['propose 44 BLACK ALB']);
  const cancelled = await runChatTool(fakeHost({ save: 'cancelled' }).host, 'save_preset', { slot: 'p45', name: 'BLACK ALB' });
  assert.match(cancelled.text, /did not save/);
  assert.equal((await runChatTool(fakeHost().host, 'save_preset', { slot: 'F01', name: 'X' })).ok, false, 'factory slots cannot be saved');
});

test('select_preset goes through the editor, which may keep the current preset', async () => {
  const yes = fakeHost();
  assert.equal((await runChatTool(yes.host, 'select_preset', { preset: 'P10' })).ok, true);
  assert.deepEqual(yes.calls, ['select 9']);
  const no = await runChatTool(fakeHost({ select: false }).host, 'select_preset', { preset: 'P10' });
  assert.deepEqual(no.ok, false);
  assert.match(no.text, /kept the current preset/);
});

test('undo, revert and the read tools', async () => {
  const { host } = fakeHost();
  assert.match((await runChatTool(host, 'undo_edit', {})).text, /Nothing to undo/);
  await runChatTool(host, 'edit_preset', { changes: [{ kind: 'volume', value: 50 }] });
  assert.match((await runChatTool(host, 'undo_edit', {})).text, /volume 65/);
  assert.match((await runChatTool(host, 'get_preset', {})).text, /^P08 "IRON-RHY"/);
  assert.match((await runChatTool(host, 'list_presets', {})).text, /^P01 NAME 1\nP02 NAME 2/);
  assert.match((await runChatTool(host, 'list_models', { block: 'drv' })).text, /^DRV models:/);
  assert.equal((await runChatTool(host, 'revert_preset', {})).ok, true);
});

test('unknown tools and malformed arguments are errors the model can read, never throws', async () => {
  const { host } = fakeHost();
  assert.deepEqual(await runChatTool(host, 'format_disk', {}), { ok: false, text: 'Error: unknown tool format_disk' });
  assert.equal((await runChatTool(host, 'edit_preset', { changes: 'louder' })).ok, false);
  assert.equal((await runChatTool(host, 'save_preset', { slot: 'P45' })).ok, false);
  assert.equal((await runChatTool(host, 'edit_preset', null)).ok, false);
});

test('tools shared with the MCP server take the same parameters as its frozen contract', () => {
  const contract: Record<string, string> = JSON.parse(readFileSync(new URL('../../../apps/mcp/test/fixtures/tool-contract.json', import.meta.url), 'utf8'));
  // Chat-only: saving as a proposal, and the editor's tone library.
  const CHAT_ONLY = ['save_preset', 'list_saved_tones', 'load_saved_tone', 'keep_tone'];
  const shared = CHAT_TOOLS.filter((t) => !CHAT_ONLY.includes(t.name));
  assert.deepEqual(shared.map((t) => t.name).sort(), ['edit_preset', 'get_preset', 'list_models', 'list_presets', 'revert_preset', 'select_preset', 'undo_edit']);
  for (const t of shared) assert.equal(shape(t.parameters as Schema), contract[t.name], t.name);
  assert.equal(shape(CHAT_TOOLS.find((t) => t.name === 'save_preset')!.parameters as Schema), '{ slot: string, name: string }');
});

test('the first message carries the preset and every block\'s models, so a tone takes few requests', () => {
  const text = chatContext(fakeHost().host);
  assert.match(text, /^Loaded preset:\nP08 "IRON-RHY"/);
  for (const label of ['NR', 'DRV', 'AMP', 'IR', 'RVB']) assert.match(text, new RegExp(`\\n${label} models:\\n`));
  assert.match(CHAT_INSTRUCTIONS, /Save dialog/);
});

test('a preset loaded during a reply makes the change tools refuse, until the model looks again', async () => {
  const { host, calls } = fakeHost();
  const guard = { index: 7 };
  const snap = host.snapshot;
  host.snapshot = () => ({ ...snap(), index: 9, name: 'THR-CLEAN' }); // the person loaded P10 meanwhile
  for (const [tool, args] of [['edit_preset', { changes: [{ kind: 'volume', value: 50 }] }], ['undo_edit', {}], ['revert_preset', {}], ['save_preset', { slot: 'P45', name: 'X' }]] as const) {
    const r = await runChatTool(host, tool, args, guard);
    assert.equal(r.ok, false, tool);
    assert.match(r.text, /preset changed to P10/);
  }
  assert.deepEqual(calls, []);
  assert.match((await runChatTool(host, 'get_preset', {}, guard)).text, /^P10 "THR-CLEAN"/);
  assert.equal((await runChatTool(host, 'edit_preset', { changes: [{ kind: 'volume', value: 50 }] }, guard)).ok, true, 'looking again moves the guard');
});

test('loading a preset through the tool moves the guard to it', async () => {
  const { host } = fakeHost();
  const guard = { index: 7 };
  await runChatTool(host, 'select_preset', { preset: 'P10' }, guard);
  assert.equal(guard.index, 7, 'the fake host stays on P08, so the guard follows what is loaded');
});

/** A host with a tone library, as the editor has. */
function libraryHost() {
  const base = fakeHost();
  const kept: string[] = [];
  const tones = [{ name: 'BLACK RHY', notes: 'Metallica Black Album, rhythm' }];
  const host: ToneHost = {
    ...base.host,
    savedTones: () => tones,
    async loadSavedTone(name) { base.calls.push(`load ${name}`); return tones.some((t) => t.name.toLowerCase() === name.toLowerCase()); },
    async keepTone(name, notes) { kept.push(`${name} / ${notes}`); },
  };
  return { host, calls: base.calls, kept };
}

test('saved tones: listed in the first message, loaded by name, and kept with the reference', async () => {
  const { host, calls, kept } = libraryHost();
  assert.match(chatContext(host), /\n\nSaved tones \(load_saved_tone\):\n- BLACK RHY: Metallica Black Album, rhythm$/);
  assert.match((await runChatTool(host, 'list_saved_tones', {})).text, /^- BLACK RHY: Metallica Black Album, rhythm$/);
  const loaded = await runChatTool(host, 'load_saved_tone', { name: 'black rhy' });
  assert.equal(loaded.ok, true);
  assert.match(loaded.text, /^Loaded the saved tone "black rhy"\.\n\nP08/);
  assert.equal((await runChatTool(host, 'load_saved_tone', { name: 'NOPE' })).ok, false);
  assert.deepEqual(calls, ['load black rhy', 'load NOPE']);
  const keep = await runChatTool(host, 'keep_tone', { name: 'AND JUSTIC', notes: 'Metallica ...And Justice, rhythm' });
  assert.equal(keep.ok, true);
  assert.deepEqual(kept, ['AND JUSTIC / Metallica ...And Justice, rhythm']);
  assert.equal((await runChatTool(host, 'keep_tone', { name: 'Way too long name', notes: 'x' })).ok, false, 'names follow the pedal rule');
});

test('without a library (the MCP server, a bare host) the library tools say so, and the context has none', async () => {
  const { host } = fakeHost();
  assert.doesNotMatch(chatContext(host), /Saved tones/);
  assert.match((await runChatTool(host, 'load_saved_tone', { name: 'X' })).text, /no saved tones here/);
});

test('loading or keeping a tone also stops when the person loaded another preset mid-reply', async () => {
  const { host } = libraryHost();
  const snap = host.snapshot;
  host.snapshot = () => ({ ...snap(), index: 9 });
  for (const [tool, args] of [['load_saved_tone', { name: 'BLACK RHY' }], ['keep_tone', { name: 'X', notes: 'y' }]] as const) {
    assert.match((await runChatTool(host, tool, args, { index: 7 })).text, /preset changed to P10/, tool);
  }
});

test('changing a block that stays off says it is not heard, so the model can turn it on', async () => {
  const { host } = fakeHost();
  const off = await runChatTool(host, 'edit_preset', { changes: [{ kind: 'parameter', block: 'dly', parameter: 'mix', value: 30 }] });
  assert.match(off.text, /Note: DLY is off, so these changes are not heard\. Turn it on if it should be heard\./);
  const on = await runChatTool(fakeHost().host, 'edit_preset', { changes: [{ kind: 'parameter', block: 'dly', parameter: 'mix', value: 30 }, { kind: 'block', block: 'dly', on: true }] });
  assert.doesNotMatch(on.text, /Note:/);
});
