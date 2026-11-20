import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import type { Session } from './session.ts';

const { version: VERSION } = packageJson;

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
export interface Timing {
  readonly tool: string;
  /** Time spent in the tool, almost all of it talking to the pedal. */
  readonly ms: number;
  readonly ok: boolean;
}

export interface ServerOptions {
  onTiming?: (timing: Timing) => void;
}

/** Runs a session call, times it, and turns its result or error into tool text the assistant can act on. */
async function reply(tool: string, options: ServerOptions, run: () => Promise<string>): Promise<Reply> {
  const started = performance.now();
  const timed = (ok: boolean) => options.onTiming?.({ tool, ms: Math.round(performance.now() - started), ok });
  try {
    const text = await run();
    timed(true);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    timed(false);
    console.error('[pocket-master-mcp]', error);
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const LIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const WRITE_SLOT = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export function createServer(session: Session, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'pocket-master', version: VERSION }, {
    instructions: [
      'Controls a Sonicake Pocket Master guitar pedal over USB.',
      'The loaded preset lives in an edit buffer: edit_preset changes the sound at once but nothing is stored until save_preset.',
      'select_preset and revert_preset discard unsaved edits; check "unsaved changes" in get_preset and ask the user first.',
      'save_preset and restore_backup overwrite a user slot: only call them when the user asked for that slot, and pass its label as confirm.',
      'Before building a tone from a reference, call list_preset_files: if an approved tone matches the request, load it with import_preset instead of rebuilding it.',
      'To match a reference tone (an artist, a record, a song), work out the gear used on it, call list_models once to see which pedal models are based on that gear (model names are disguised, e.g. "Calif DualM" is a Mesa/Boogie Dual Rectifier), then build the whole chain with one edit_preset: drive, amp, cabinet, EQ, gate, modulation, delay and reverb, with sensible values. Do not ask for details the user did not give: make reasonable choices, say briefly what you chose and why, and invite them to ask for adjustments by ear. When the user says a tone sounds right, offer to keep it with export_preset and notes naming the reference, so next time it loads at once.',
      'Keep calls few: edit_preset, select_preset, save_preset and import_preset already return the resulting preset, and list_models only needs to be called once per conversation.',
    ].join(' '),
  });

  server.registerTool('get_preset', {
    title: 'Get the loaded preset',
    description: 'The preset loaded on the pedal: name, volume, amp mode, unsaved-changes flag, chain order and every block with its model, on/off state and parameter values.',
    annotations: READ,
  }, () => reply('get_preset', options, () => session.describe()));

  server.registerTool('list_presets', {
    title: 'List presets',
    description: 'Names of all 100 presets (P01..P50 user, F01..F50 factory).',
    annotations: READ,
  }, () => reply('list_presets', options, () => session.listPresets()));

  server.registerTool('list_models', {
    title: 'List the models of the pedal',
    description: 'Every model a block can use (or, without block, of every block), with the real gear the manual says it is based on, a short description and its parameters with ranges. Call it without block to learn the whole pedal before building a tone. User IRs are named after the loaded IR files; AMP also lists the captured profiles loaded on the pedal.',
    inputSchema: { block: block.optional() },
    annotations: READ,
  }, ({ block }) => reply('list_models', options, () => session.listModels(block)));

  server.registerTool('edit_preset', {
    title: 'Edit the loaded preset',
    description: 'Changes the sound right away, in the edit buffer only (nothing is saved). Changes apply in order and are all checked before any is sent, so a model change can be followed by that model\'s parameters. Names are matched ignoring case; an unknown or ambiguous name fails with the valid choices. Returns the preset as the pedal now holds it.',
    inputSchema: { changes: z.array(change).min(1).max(50) },
    annotations: LIVE,
  }, ({ changes }) => reply('edit_preset', options, () => session.edit(changes)));

  server.registerTool('select_preset', {
    title: 'Load a preset',
    description: 'Loads a preset, like turning the preset knob. Unsaved edits of the current preset are lost.',
    inputSchema: { preset: slot },
    annotations: LIVE,
  }, ({ preset }) => reply('select_preset', options, () => session.select(preset)));

  server.registerTool('revert_preset', {
    title: 'Revert unsaved edits',
    description: 'Reloads the loaded preset from its slot, discarding every unsaved edit.',
    annotations: LIVE,
  }, () => reply('revert_preset', options, () => session.revert()));

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
  }, (args) => reply('save_preset', options, () => session.save(args)));

  server.registerTool('restore_backup', {
    title: 'Restore a backed-up slot',
    description: 'Writes a slot from a backup file back to its slot, under its backed-up name. What it overwrites is backed up first. Loads that slot, so unsaved edits are lost.',
    inputSchema: {
      file: z.string().describe('Backup file returned by save_preset or restore_backup (inside ~/.pocket-master-editor/backups)'),
      slot: slot.optional().describe('Which slot of the backup, when it holds several'),
      confirm: z.string().describe('Must repeat the slot label being restored, e.g. "P03"'),
    },
    annotations: WRITE_SLOT,
  }, (args) => reply('restore_backup', options, () => session.restore(args)));

  server.registerTool('export_preset', {
    title: 'Export the loaded preset to a file',
    description: 'Writes the edit buffer to a preset file (JSON, the same format as the web editor) inside ~/.pocket-master-editor/presets. Never overwrites a file.',
    inputSchema: {
      file: z.string().optional().describe('File path; omitted, a name is made from the preset label and name'),
      notes: z.string().max(500).optional().describe('What the tone is, e.g. "Metallica - Black Album rhythm, approved by ear"; shown by list_preset_files'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ file, notes }) => reply('export_preset', options, () => session.exportPreset(file, notes)));

  server.registerTool('list_preset_files', {
    title: 'List saved tones',
    description: 'Preset files in ~/.pocket-master-editor/presets with their notes: the user\'s library of approved tones. Check it before building a tone from a reference; import_preset loads one at once.',
    annotations: READ,
  }, () => reply('list_preset_files', options, () => session.listPresetFiles()));

  server.registerTool('load_ir', {
    title: 'Load a WAV into a user IR slot',
    description: 'Writes a cabinet impulse response (WAV) from ~/.pocket-master-editor/irs into user IR slot 1..5 of the pedal (stored as 512 taps at 44.1 kHz). The pedal cannot send an IR back, so the IR a slot held is lost: an occupied slot is only overwritten with replace: true. Only call it when the user asked for that slot. Afterwards choose the slot in the IR block with edit_preset.',
    inputSchema: {
      file: z.string().describe('WAV file name inside ~/.pocket-master-editor/irs'),
      slot: z.number().int().min(1).max(5).describe('User IR slot 1..5'),
      confirm: z.string().describe('Must be "IR<slot>", e.g. "IR3", confirming the user asked to write that slot'),
      name: z.string().max(10).optional().describe('Name shown on the pedal, 1..10 ASCII characters; defaults to the file name'),
      replace: z.boolean().default(false).describe('Overwrite a slot that already holds an IR (it cannot be backed up)'),
    },
    annotations: WRITE_SLOT,
  }, (args) => reply('load_ir', options, () => session.loadIr(args)));

  server.registerTool('rename_slot', {
    title: 'Rename a user IR or profile slot',
    description: 'Renames a loaded user IR (name 1..10 characters) or captured profile (1..15) on the pedal; the IR or profile itself is not changed.',
    inputSchema: {
      kind: z.enum(['ir', 'profile']),
      slot: z.number().int().min(1).max(5),
      name: z.string().min(1).max(15),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, (args) => reply('rename_slot', options, () => session.renameSlot(args)));

  server.registerTool('get_global_settings', {
    title: 'Get global settings',
    description: 'Device-wide settings that are not part of any preset: master volume, input/FX-rec/monitor/BT-rec levels, USB recording mode, re-amp, EXP/FS jack type, backlight, ECO.',
    annotations: READ,
  }, () => reply('get_global_settings', options, () => session.getGlobals()));

  const level = z.number().int().min(-20).max(20);
  const flag = z.number().int().min(0).max(1);
  server.registerTool('set_global_settings', {
    title: 'Change global settings',
    description: 'Changes device-wide settings (they affect every preset and are kept by the pedal at once). Levels are dB -20..20; mode 0 dry / 1 wet; expFsType 0 expression pedal, 1 single footswitch, 2 dual footswitch; targets by name (expression: VOL, FX1, DRV, AMP, IR, FX2, DLY, RVB; footswitch: Preset-, Preset+, Tap Tempo, NR, FX1, DRV, AMP, IR, EQ, FX2, DLY, RVB, CTRL 1, CTRL 2, Drum, REC/Play, Loop Stop, Tuner). Ask the user before changing these. Factory reset is not available here.',
    inputSchema: {
      masterVolume: z.number().int().min(0).max(100).optional(),
      inputLevel: level.optional(), fxRecLevel: level.optional(), monitorLevel: level.optional(), btRecLevel: level.optional(),
      mode: flag.optional(), reamp: flag.optional(), eco: flag.optional(), powerConfirm: flag.optional(), battOnly: flag.optional(),
      expFsType: z.number().int().min(0).max(2).optional(),
      backlight: z.number().int().min(0).max(100).optional(),
      expTarget: z.string().optional(), fsTarget: z.string().optional(), fs1Target: z.string().optional(), fs2Target: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, (args) => reply('set_global_settings', options, () => session.setGlobals(args)));

  server.registerTool('load_nam', {
    title: 'Convert a NAM capture into a profile slot',
    description: 'Converts a NAM capture (.nam, WaveNet) from ~/.pocket-master-editor/nams into the pedal\'s captured-profile format and writes it to profile slot 1..5; takes about one to a few minutes. The pedal cannot send a profile back, so an occupied slot is only overwritten with replace: true. Only when the user asked for that slot. Afterwards pick it on AMP with edit_preset.',
    inputSchema: {
      file: z.string().describe('.nam file name inside ~/.pocket-master-editor/nams'),
      slot: z.number().int().min(1).max(5).describe('Profile slot 1..5'),
      confirm: z.string().describe('Must be "PROFILE<slot>", e.g. "PROFILE2"'),
      name: z.string().max(15).optional().describe('Name shown on the pedal, 1..15 ASCII characters; defaults to the file name'),
      replace: z.boolean().default(false).describe('Overwrite a slot that already holds a profile (it cannot be backed up)'),
    },
    annotations: WRITE_SLOT,
  }, (args) => reply('load_nam', options, () => session.loadNam(args)));

  server.registerTool('tone3000_login', {
    title: 'Sign in to TONE3000',
    description: 'Starts the TONE3000 sign-in: returns a link and a code for the user to approve at tone3000.com; the server keeps the sign-in afterwards. Call it again to check.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, () => reply('tone3000_login', options, () => session.tone3000Login()));

  server.registerTool('search_tone3000', {
    title: 'Search TONE3000',
    description: 'Searches TONE3000 (tone3000.com), the community library of NAM amp captures and cabinet IRs, e.g. for gear the pedal has no model of (a Gallien-Krueger, a Mark IIC+). Results show the tone id, title, creator and link; credit TONE3000 and the creator when you present them. Needs tone3000_login once.',
    inputSchema: {
      query: z.string().min(1).describe('Words to search, e.g. "gallien krueger 250ml"'),
      format: z.enum(['nam', 'ir']).default('nam').describe('nam for amp captures, ir for cabinet impulse responses'),
      page: z.number().int().min(1).default(1),
    },
    annotations: { ...READ, openWorldHint: true },
  }, (args) => reply('search_tone3000', options, () => session.searchTone3000(args)));

  server.registerTool('install_tone', {
    title: 'Install a TONE3000 tone on the pedal',
    description: 'Downloads a model of a TONE3000 tone and puts it on the pedal: a NAM capture is converted (about one to a few minutes) and written to profile slot 1..5 (confirm "PROFILE<n>"); a cabinet IR is written to user IR slot 1..5 (confirm "IR<n>"). An occupied slot is only overwritten with replace: true, as it cannot be backed up. Only when the user asked for that slot.',
    inputSchema: {
      toneId: z.number().int().describe('Tone id from search_tone3000'),
      modelId: z.number().int().optional().describe('Model id when the tone has several (the error lists them)'),
      slot: z.number().int().min(1).max(5).describe('Profile slot (NAM) or user IR slot (IR), 1..5'),
      confirm: z.string().describe('"PROFILE<slot>" for a capture, "IR<slot>" for an IR'),
      name: z.string().max(15).optional().describe('Name on the pedal; defaults to the model name'),
      replace: z.boolean().default(false).describe('Overwrite a slot that is not empty'),
    },
    annotations: { ...WRITE_SLOT, openWorldHint: true },
  }, (args) => reply('install_tone', options, () => session.installTone(args)));

  server.registerTool('import_preset', {
    title: 'Load a preset file',
    description: 'Loads a preset file from ~/.pocket-master-editor/presets into the edit buffer with live edits (nothing is saved).',
    inputSchema: { file: z.string().describe('Preset file path') },
    annotations: LIVE,
  }, ({ file }) => reply('export_preset', options, () => session.importPreset(file)));

  return server;
}
