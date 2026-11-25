import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_TOOLS } from '@pocket-master/core';
import { AI_TOOLS, registerAiAgent, runAiTool } from '../lib/aiBridge.ts';
import type { ToneAgent } from '../lib/assistant.ts';
import { MB_CHAT_TOOLS } from '../lib/matriboxAgent.ts';

/** A tone agent whose runner records the calls it gets. */
function agent(calls: { name: string; args: unknown }[]): ToneAgent {
  return {
    tools: [],
    acts: new Set(),
    instructions: () => '',
    context: () => '',
    current: () => '',
    runner: () => async (name, args) => {
      calls.push({ name, args });
      if (name === 'edit_preset') throw new Error('The editor is busy');
      return { ok: true, text: `ran ${name}` };
    },
    watch: () => () => undefined,
    offerSave: () => null,
  };
}

test('the connection offers both pedals: Pocket Master tools by their names, the Matribox ones prefixed', () => {
  const names = AI_TOOLS.map((t) => t.name);
  assert.equal(names[0], 'which_pedal');
  for (const t of CHAT_TOOLS) assert.ok(names.includes(t.name), t.name);
  for (const t of MB_CHAT_TOOLS) assert.ok(names.includes(`matribox_${t.name}`), t.name);
  assert.equal(new Set(names).size, names.length, 'no name twice');
  for (const t of AI_TOOLS) assert.equal(t.inputSchema.type, 'object', t.name);
});

test('with no pedal connected, every tool answers with a clear error', async () => {
  assert.match((await runAiTool('which_pedal', {})).text, /No pedal is connected/);
  const pm = await runAiTool('get_preset', {});
  assert.equal(pm.ok, false);
  assert.match(pm.text, /no Pocket Master is connected/);
  const mb = await runAiTool('matribox_get_preset', {});
  assert.equal(mb.ok, false);
  assert.match(mb.text, /no Matribox II Pro is connected/);
  assert.deepEqual(await runAiTool('rm_rf', {}), { ok: false, text: 'Error: unknown tool rm_rf' });
});

test('calls run on the connected pedal’s assistant, with the prefix taken off; errors come back as text', async () => {
  const calls: { name: string; args: unknown }[] = [];
  const off = registerAiAgent('matribox', agent(calls));
  try {
    assert.deepEqual(await runAiTool('matribox_build_tone', { blocks: [] }), { ok: true, text: 'ran build_tone' });
    assert.deepEqual(calls, [{ name: 'build_tone', args: { blocks: [] } }]);
    assert.deepEqual(await runAiTool('matribox_edit_preset', {}), { ok: false, text: 'Error: The editor is busy' });
    assert.match((await runAiTool('which_pedal', {})).text, /Matribox II Pro connected/);
    assert.equal((await runAiTool('get_preset', {})).ok, false, 'the Pocket Master is still not connected');
  } finally {
    off();
  }
  assert.equal((await runAiTool('matribox_get_preset', {})).ok, false, 'withdrawn with the editor');
});

test('withdrawing an old registration leaves a newer one in place', async () => {
  const calls: { name: string; args: unknown }[] = [];
  const first = registerAiAgent('pocket', agent([]));
  const second = registerAiAgent('pocket', agent(calls));
  first();
  assert.deepEqual(await runAiTool('get_preset', {}), { ok: true, text: 'ran get_preset' });
  assert.equal(calls.length, 1);
  second();
});
