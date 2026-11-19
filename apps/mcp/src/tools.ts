import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from './session.ts';

const VERSION = '0.7.0';

const block = z.string().describe('Block label: NR, FX1, DRV, AMP, IR, EQ, FX2, DLY or RVB');
const slot = z.string().describe('Preset label, e.g. "P09" (user presets are P01..P50, factory presets F01..F50)');

const change = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('parameter'),
    block,
    parameter: z.string().describe('Parameter name of the block\'s current model, as get_preset shows it (e.g. "Gain")'),
    value: z.union([z.number(), z.boolean(), z.string()]).describe('A number in the parameter\'s range, true/false for a switch, or an option name'),
  }),
  z.object({ kind: z.literal('block'), block, on: z.boolean() }),
  z.object({ kind: z.literal('model'), block, model: z.string().describe('Model name from list_models; for AMP, a captured profile name selects clone mode') }),
  z.object({ kind: z.literal('move'), block, position: z.number().int().describe('1-based position in the chain; DRV, AMP, IR and EQ move together') }),
  z.object({ kind: z.literal('volume'), value: z.number().int().min(0).max(100).describe('Preset volume 0..100') }),
]);

type Reply = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Runs a session call and turns its result, or its error, into tool text the assistant can act on. */
async function reply(run: () => Promise<string>): Promise<Reply> {
  try {
    return { content: [{ type: 'text', text: await run() }] };
  } catch (error) {
    console.error('[pocket-master-mcp]', error);
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const LIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const WRITE_SLOT = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export function createServer(session: Session): McpServer {
  const server = new McpServer({ name: 'pocket-master', version: VERSION }, {
    instructions: [
      'Controls a Sonicake Pocket Master guitar pedal over USB.',
      'The loaded preset lives in an edit buffer: edit_preset changes the sound at once but nothing is stored until save_preset.',
      'select_preset and revert_preset discard unsaved edits; check "unsaved changes" in get_preset and ask the user first.',
      'save_preset and restore_backup overwrite a user slot: only call them when the user asked for that slot, and pass its label as confirm.',
    ].join(' '),
  });

  server.registerTool('get_preset', {
    title: 'Get the loaded preset',
    description: 'The preset loaded on the pedal: name, volume, amp mode, unsaved-changes flag, chain order and every block with its model, on/off state and parameter values.',
    annotations: READ,
  }, () => reply(() => session.describe()));

  server.registerTool('list_presets', {
    title: 'List presets',
    description: 'Names of all 100 presets (P01..P50 user, F01..F50 factory).',
    annotations: READ,
  }, () => reply(() => session.listPresets()));

  server.registerTool('list_models', {
    title: 'List models of a block',
    description: 'Models a block can use. User IRs are named after the IR file loaded in each slot; AMP also lists the captured profiles loaded on the pedal.',
    inputSchema: { block },
    annotations: READ,
  }, ({ block }) => reply(() => session.listModels(block)));

  server.registerTool('edit_preset', {
    title: 'Edit the loaded preset',
    description: 'Changes the sound right away, in the edit buffer only (nothing is saved). Changes apply in order and are all checked before any is sent, so a model change can be followed by that model\'s parameters. Names are matched ignoring case; an unknown or ambiguous name fails with the valid choices. Returns the preset as the pedal now holds it.',
    inputSchema: { changes: z.array(change).min(1).max(50) },
    annotations: LIVE,
  }, ({ changes }) => reply(() => session.edit(changes)));

  server.registerTool('select_preset', {
    title: 'Load a preset',
    description: 'Loads a preset, like turning the preset knob. Unsaved edits of the current preset are lost.',
    inputSchema: { preset: slot },
    annotations: LIVE,
  }, ({ preset }) => reply(() => session.select(preset)));

  server.registerTool('revert_preset', {
    title: 'Revert unsaved edits',
    description: 'Reloads the loaded preset from its slot, discarding every unsaved edit.',
    annotations: LIVE,
  }, () => reply(() => session.revert()));

  server.registerTool('save_preset', {
    title: 'Save to a user slot',
    description: 'Saves the edit buffer to a user slot (P01..P50) under a name, overwriting that slot. By default the slot is first backed up to a file (its path is returned; restore_backup undoes the save). The saved slot is read back and checked.',
    inputSchema: {
      slot: slot,
      name: z.string().min(1).max(10).describe('Preset name, 1..10 printable ASCII characters'),
      confirm: z.string().describe('Must repeat the slot label (e.g. "P03"), confirming the user asked to overwrite it'),
      backup: z.boolean().default(true).describe('Back up the slot before overwriting it (default true)'),
    },
    annotations: WRITE_SLOT,
  }, (args) => reply(() => session.save(args)));

  server.registerTool('restore_backup', {
    title: 'Restore a backed-up slot',
    description: 'Writes a slot from a backup file back to its slot, under its backed-up name. What it overwrites is backed up first. Loads that slot, so unsaved edits are lost.',
    inputSchema: {
      file: z.string().describe('Path of a backup file returned by save_preset or restore_backup'),
      slot: slot.optional().describe('Which slot of the backup, when it holds several'),
      confirm: z.string().describe('Must repeat the slot label being restored, e.g. "P03"'),
    },
    annotations: WRITE_SLOT,
  }, (args) => reply(() => session.restore(args)));

  server.registerTool('export_preset', {
    title: 'Export the loaded preset to a file',
    description: 'Writes the edit buffer to a preset file (JSON, the same format as the web editor). Never overwrites a file. Relative paths go under ~/.pocket-master-editor/presets.',
    inputSchema: { file: z.string().optional().describe('File path; omitted, a name is made from the preset label and name') },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ file }) => reply(() => session.exportPreset(file)));

  server.registerTool('import_preset', {
    title: 'Load a preset file',
    description: 'Loads a preset file into the edit buffer with live edits (nothing is saved). Relative paths are read from ~/.pocket-master-editor/presets.',
    inputSchema: { file: z.string().describe('Preset file path') },
    annotations: LIVE,
  }, ({ file }) => reply(() => session.importPreset(file)));

  return server;
}
