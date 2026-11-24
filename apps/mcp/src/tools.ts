import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { describePedals } from './devices.ts';
import type { MatriboxSession } from './matribox-session.ts';
import { registerMatriboxLive } from './matribox-live-tools.ts';
import type { Session } from './session.ts';

const { version: VERSION } = packageJson;

const block = z.string().describe('Block label: NR, FX1, DRV, AMP, IR, EQ, FX2, DLY or RVB');
const slot = z.string().describe('Preset label, e.g. "P09" (user presets are P01..P50, factory presets F01..F50)');

const change = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('parameter'),
    block,
    parameter: z.string().describe('Parameter name of the block\'s current model, as get_preset shows it (e.g. "Gain")'),
    value: z.union([z.number(), z.boolean(), z.string()]).describe("A number in the parameter's range, true/false for a switch, or an option name"),
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
  /** The Matribox II Pro; without it those tools answer with an error. */
  matribox?: MatriboxSession;
  /** MIDI port names, for which_pedal. */
  midiPorts?: () => Promise<readonly string[]>;
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
  const server = new McpServer(
    { name: 'pocket-master', version: VERSION },
    {
      instructions: [
        'Controls Sonicake guitar pedals over USB: the Pocket Master (the tools without a prefix) and the Matribox II Pro (the matribox_ tools; their writes are experimental). If you do not know which pedal the user has, call which_pedal first.',
        'The loaded preset lives in an edit buffer: edit_preset changes the sound at once but nothing is stored until save_preset.',
        'select_preset and revert_preset discard unsaved edits; check "unsaved changes" in get_preset and ask the user first. To go back one change instead of all of them, use undo_edit.',
        'save_preset and restore_backup overwrite a user slot: only call them when the user asked for that slot, and pass its label as confirm.',
        'Before building a tone from a reference, call list_preset_files: if an approved tone matches the request, load it with import_preset instead of rebuilding it.',
        'To match a reference tone (an artist, a record, a song), work out the gear used on it, call list_models once to see which pedal models are based on that gear (model names are disguised, e.g. "Calif DualM" is a Mesa/Boogie Dual Rectifier), then build the whole chain with one edit_preset: drive, amp, cabinet, EQ, gate, modulation, delay and reverb, with sensible values. Do not ask for details the user did not give: make reasonable choices, say briefly what you chose and why, and invite them to ask for adjustments by ear. When the user says a tone sounds right, offer to keep it with export_preset and notes naming the reference, so next time it loads at once.',
        'Matribox II Pro: matribox_get_preset shows the loaded preset (chain in signal order, each block\'s model and the real gear it is based on, on/off, parameters with ranges); matribox_list_models is the palette, with each model\'s origin (the real gear: e.g. a model based on "Ibanez TS808" is the Tube Screamer). To plan a tone from a reference, work out the gear used, then find the models whose origin matches it. matribox_build_tone sends a whole chain in one call; matribox_set_param, matribox_set_module_on, matribox_set_model, matribox_add_block, matribox_remove_block and matribox_move_block adjust it. They change the loaded preset only: matribox_save_preset stores it (confirm with the slot label; the slot is backed up first). Matribox writes are experimental (validated on one unit so far): after writing, check with matribox_get_preset and tell the user. matribox_export_preset and matribox_import_preset move whole presets as .prst files, and matribox_restore_backup undoes a matribox_save_preset (both overwrite a slot only with confirm); matribox_backup_all_presets keeps all 240 presets in one file and matribox_restore_all_presets puts them back (confirm "ALL"); they store the whole preset in the slot in one write, assignments, volume and tempo included (experimental). matribox_get_assignments shows the patch volume, tempo, footswitch and expression-pedal assignments; matribox_set_volume, matribox_assign_footswitch, matribox_assign_expression and matribox_set_expression_range change them live; matribox_tuner, matribox_tap_tempo, matribox_set_bpm, matribox_looper, matribox_drum, matribox_ctrl and matribox_quick_knob send the manual\'s MIDI Control Changes, which the unit does not answer (all experimental). matribox_load_ir loads a WAV from ~/.pocket-master-editor/irs into a user IR slot (confirm "IR<slot>"; an occupied slot only with replace: true; experimental).',
        'Keep calls few: edit_preset, select_preset, save_preset and import_preset already return the resulting preset, and list_models only needs to be called once per conversation.',
      ].join(' '),
    },
  );

  server.registerTool(
    'get_preset',
    {
      title: 'Get the loaded preset',
      description: 'The preset loaded on the pedal: name, volume, amp mode, unsaved-changes flag, chain order and every block with its model, on/off state and parameter values.',
      annotations: READ,
    },
    () => reply('get_preset', options, () => session.describe()),
  );

  server.registerTool(
    'list_presets',
    {
      title: 'List presets',
      description: 'Names of all 100 presets (P01..P50 user, F01..F50 factory).',
      annotations: READ,
    },
    () => reply('list_presets', options, () => session.listPresets()),
  );

  server.registerTool(
    'list_models',
    {
      title: 'List the models of the pedal',
      description:
        'Every model a block can use (or, without block, of every block), with the real gear the manual says it is based on, a short description and its parameters with ranges. Call it without block to learn the whole pedal before building a tone. User IRs are named after the loaded IR files; AMP also lists the captured profiles loaded on the pedal.',
      inputSchema: { block: block.optional() },
      annotations: READ,
    },
    ({ block }) => reply('list_models', options, () => session.listModels(block)),
  );

  server.registerTool(
    'edit_preset',
    {
      title: 'Edit the loaded preset',
      description:
        "Changes the sound right away, in the edit buffer only (nothing is saved). Changes apply in order and are all checked before any is sent, so a model change can be followed by that model's parameters. Names are matched ignoring case; an unknown or ambiguous name fails with the valid choices. Returns the preset as the pedal now holds it.",
      inputSchema: { changes: z.array(change).min(1).max(50) },
      annotations: LIVE,
    },
    ({ changes }) => reply('edit_preset', options, () => session.edit(changes)),
  );

  server.registerTool(
    'select_preset',
    {
      title: 'Load a preset',
      description: 'Loads a preset, like turning the preset knob. Unsaved edits of the current preset are lost.',
      inputSchema: { preset: slot },
      annotations: LIVE,
    },
    ({ preset }) => reply('select_preset', options, () => session.select(preset)),
  );

  server.registerTool(
    'revert_preset',
    {
      title: 'Revert unsaved edits',
      description: 'Reloads the loaded preset from its slot, discarding every unsaved edit.',
      annotations: LIVE,
    },
    () => reply('revert_preset', options, () => session.revert()),
  );

  server.registerTool(
    'undo_edit',
    {
      title: 'Undo the last edit',
      description:
        'Puts the edit buffer back as it was before the last edit_preset (call again to go further back, up to 20). Use it when the user did not like the last change. Only for edits since the preset was loaded: loading, reverting, saving or importing clears it, and it refuses if the pedal is on another preset now. Nothing is saved.',
      annotations: LIVE,
    },
    () => reply('undo_edit', options, () => session.undo()),
  );

  server.registerTool(
    'save_preset',
    {
      title: 'Save to a user slot',
      description:
        'Saves the edit buffer to a user slot (P01..P50) under a name, overwriting that slot. By default the slot is first backed up to a file (its path is returned; restore_backup undoes the save). The saved slot is read back and checked.',
      inputSchema: {
        slot: slot,
        name: z.string().min(1).max(10).describe('Preset name, 1..10 printable ASCII characters'),
        confirm: z.string().describe('Must repeat the slot label (e.g. "P03"), confirming the user asked to overwrite it'),
        backup: z.boolean().default(true).describe('Back up the slot before overwriting it (default true)'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('save_preset', options, () => session.save(args)),
  );

  server.registerTool(
    'restore_backup',
    {
      title: 'Restore a backed-up slot',
      description: 'Writes a slot from a backup file back to its slot, under its backed-up name. What it overwrites is backed up first. Loads that slot, so unsaved edits are lost.',
      inputSchema: {
        file: z.string().describe('Backup file returned by save_preset or restore_backup (inside ~/.pocket-master-editor/backups)'),
        slot: slot.optional().describe('Which slot of the backup, when it holds several'),
        confirm: z.string().describe('Must repeat the slot label being restored, e.g. "P03"'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('restore_backup', options, () => session.restore(args)),
  );

  server.registerTool(
    'export_preset',
    {
      title: 'Export the loaded preset to a file',
      description: 'Writes the edit buffer to a preset file (JSON, the same format as the web editor) inside ~/.pocket-master-editor/presets. Never overwrites a file.',
      inputSchema: {
        file: z.string().optional().describe('File path; omitted, a name is made from the preset label and name'),
        notes: z.string().max(500).optional().describe('What the tone is, e.g. "Metallica - Black Album rhythm, approved by ear"; shown by list_preset_files'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ file, notes }) => reply('export_preset', options, () => session.exportPreset(file, notes)),
  );

  server.registerTool(
    'list_preset_files',
    {
      title: 'List saved tones',
      description:
        "Preset files in ~/.pocket-master-editor/presets with their notes: the user's library of approved tones (.json, plus .prst files exported by Sonicake's own app). Check it before building a tone from a reference; import_preset loads one at once.",
      annotations: READ,
    },
    () => reply('list_preset_files', options, () => session.listPresetFiles()),
  );

  server.registerTool(
    'load_ir',
    {
      title: 'Load a WAV into a user IR slot',
      description:
        'Writes a cabinet impulse response (WAV) from ~/.pocket-master-editor/irs into user IR slot 1..5 of the pedal (stored as 512 taps at 44.1 kHz). The pedal cannot send an IR back, so the IR a slot held is lost: an occupied slot is only overwritten with replace: true. Only call it when the user asked for that slot. Afterwards choose the slot in the IR block with edit_preset.',
      inputSchema: {
        file: z.string().describe('WAV file name inside ~/.pocket-master-editor/irs'),
        slot: z.number().int().min(1).max(5).describe('User IR slot 1..5'),
        confirm: z.string().describe('Must be "IR<slot>", e.g. "IR3", confirming the user asked to write that slot'),
        name: z.string().max(10).optional().describe('Name shown on the pedal, 1..10 ASCII characters; defaults to the file name'),
        replace: z.boolean().default(false).describe('Overwrite a slot that already holds an IR (it cannot be backed up)'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('load_ir', options, () => session.loadIr(args)),
  );

  server.registerTool(
    'rename_slot',
    {
      title: 'Rename a user IR or profile slot',
      description: 'Renames a loaded user IR (name 1..10 characters) or captured profile (1..15) on the pedal; the IR or profile itself is not changed.',
      inputSchema: {
        kind: z.enum(['ir', 'profile']),
        slot: z.number().int().min(1).max(5),
        name: z.string().min(1).max(15),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => reply('rename_slot', options, () => session.renameSlot(args)),
  );

  server.registerTool(
    'copy_preset',
    {
      title: 'Copy a preset over a user slot',
      description:
        'Copies a stored preset (P01..P50 or F01..F50) over a user slot (P01..P50), after backing that slot up to a file (restore_backup undoes it). The loaded preset and its unsaved edits are untouched. Only when the user asked for that slot.',
      inputSchema: {
        source: z.string().describe('Preset to copy, e.g. "P10" or "F05"'),
        destination: z.string().describe('User slot to overwrite, P01..P50'),
        confirm: z.string().describe('Must repeat the destination label (e.g. "P45"), confirming the user asked to overwrite it'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => reply('copy_preset', options, () => session.copy(args)),
  );

  server.registerTool(
    'set_tuner',
    {
      title: 'Tuner on or off',
      description: "Turns the pedal's tuner on or off. The pedal does not report the tuner state, so the reply only says what was sent.",
      inputSchema: { on: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => reply('set_tuner', options, () => session.tuner(args)),
  );

  server.registerTool(
    'delete_slot',
    {
      title: 'Delete a user IR or captured profile',
      description: 'Empties user IR or captured-profile slot 1..5; it cannot be undone (keep the WAV or .nam to load it again). Only when the user asked for that slot.',
      inputSchema: {
        kind: z.enum(['ir', 'profile']),
        slot: z.number().int().min(1).max(5),
        confirm: z.string().describe('Must be "IR<slot>" for an IR or "PROFILE<slot>" for a capture, e.g. "IR3", confirming the user asked to delete that slot'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => reply('delete_slot', options, () => session.deleteSlot(args)),
  );

  server.registerTool(
    'backup_all_presets',
    {
      title: 'Back up all user presets',
      description: 'Reads P01..P50 without loading them and writes them to one backup file (restore_backup restores a slot from it). Nothing on the pedal changes.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => reply('backup_all_presets', options, () => session.backupAll()),
  );

  server.registerTool(
    'get_global_settings',
    {
      title: 'Get global settings',
      description: 'Device-wide settings that are not part of any preset: master volume, input/FX-rec/monitor/BT-rec levels, backlight, boot anti-touch protection.',
      annotations: READ,
    },
    () => reply('get_global_settings', options, () => session.getGlobals()),
  );

  const level = z.number().int().min(-20).max(20);
  const flag = z.number().int().min(0).max(1);
  server.registerTool(
    'set_global_settings',
    {
      title: 'Change global settings',
      description:
        'Changes device-wide settings (they affect every preset and are kept by the pedal at once). Levels are dB -20..20; backlight 0..100; bootProtection 0 off / 1 on. Ask the user before changing these. Factory reset is not available here.',
      inputSchema: {
        masterVolume: z.number().int().min(0).max(100).optional(),
        inputLevel: level.optional(),
        fxRecLevel: level.optional(),
        monitorLevel: level.optional(),
        btRecLevel: level.optional(),
        bootProtection: flag.optional(),
        backlight: z.number().int().min(0).max(100).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => reply('set_global_settings', options, () => session.setGlobals(args)),
  );

  server.registerTool(
    'load_nam',
    {
      title: 'Convert a NAM capture into a profile slot',
      description:
        "Converts a NAM capture (.nam, WaveNet) from ~/.pocket-master-editor/nams into the pedal's captured-profile format and writes it to profile slot 1..5; takes about one to a few minutes. The pedal cannot send a profile back, so an occupied slot is only overwritten with replace: true. Only when the user asked for that slot. Afterwards pick it on AMP with edit_preset.",
      inputSchema: {
        file: z.string().describe('.nam file name inside ~/.pocket-master-editor/nams'),
        slot: z.number().int().min(1).max(5).describe('Profile slot 1..5'),
        confirm: z.string().describe('Must be "PROFILE<slot>", e.g. "PROFILE2"'),
        name: z.string().max(15).optional().describe('Name shown on the pedal, 1..15 ASCII characters; defaults to the file name'),
        replace: z.boolean().default(false).describe('Overwrite a slot that already holds a profile (it cannot be backed up)'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('load_nam', options, () => session.loadNam(args)),
  );

  server.registerTool(
    'tone3000_login',
    {
      title: 'Sign in to TONE3000',
      description: 'Starts the TONE3000 sign-in: returns a link and a code for the user to approve at tone3000.com; the server keeps the sign-in afterwards. Call it again to check.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    () => reply('tone3000_login', options, () => session.tone3000Login()),
  );

  server.registerTool(
    'search_tone3000',
    {
      title: 'Search TONE3000',
      description:
        'Searches TONE3000 (tone3000.com), the community library of NAM amp captures and cabinet IRs, e.g. for gear the pedal has no model of (a Gallien-Krueger, a Mark IIC+). Results show the tone id, title, creator and link; credit TONE3000 and the creator when you present them. Needs tone3000_login once.',
      inputSchema: {
        query: z.string().min(1).describe('Words to search, e.g. "gallien krueger 250ml"'),
        format: z.enum(['nam', 'ir']).default('nam').describe('nam for amp captures, ir for cabinet impulse responses'),
        page: z.number().int().min(1).default(1),
      },
      annotations: { ...READ, openWorldHint: true },
    },
    (args) => reply('search_tone3000', options, () => session.searchTone3000(args)),
  );

  server.registerTool(
    'install_tone',
    {
      title: 'Install a TONE3000 tone on the pedal',
      description:
        'Downloads a model of a TONE3000 tone and puts it on the pedal: a NAM capture is converted (about one to a few minutes) and written to profile slot 1..5 (confirm "PROFILE<n>"); a cabinet IR is written to user IR slot 1..5 (confirm "IR<n>"). An occupied slot is only overwritten with replace: true, as it cannot be backed up. Only when the user asked for that slot.',
      inputSchema: {
        toneId: z.number().int().describe('Tone id from search_tone3000'),
        modelId: z.number().int().optional().describe('Model id when the tone has several (the error lists them)'),
        slot: z.number().int().min(1).max(5).describe('Profile slot (NAM) or user IR slot (IR), 1..5'),
        confirm: z.string().describe('"PROFILE<slot>" for a capture, "IR<slot>" for an IR'),
        name: z.string().max(15).optional().describe('Name on the pedal; defaults to the model name'),
        replace: z.boolean().default(false).describe('Overwrite a slot that is not empty'),
      },
      annotations: { ...WRITE_SLOT, openWorldHint: true },
    },
    (args) => reply('install_tone', options, () => session.installTone(args)),
  );

  server.registerTool(
    'import_preset',
    {
      title: 'Load a preset file',
      description: "Loads a preset file (.json, or a .prst exported by Sonicake's own app) from ~/.pocket-master-editor/presets into the edit buffer with live edits (nothing is saved).",
      inputSchema: { file: z.string().describe('Preset file path') },
      annotations: LIVE,
    },
    ({ file }) => reply('import_preset', options, () => session.importPreset(file)),
  );

  registerMatriboxTools(server, options);
  return server;
}

const noMatribox = (): never => {
  throw new Error('The Matribox II Pro tools are not available in this server.');
};

/** which_pedal and the Matribox II Pro's tools (prefixed: the Pocket Master's names are frozen). */
function registerMatriboxTools(server: McpServer, options: ServerOptions): void {
  const matribox = () => options.matribox ?? noMatribox();

  server.registerTool(
    'which_pedal',
    {
      title: 'Which pedal is connected',
      description: 'Which supported Sonicake pedals are plugged in over USB (Pocket Master, Matribox II Pro), and which tools drive each. Lists MIDI ports only; nothing is sent.',
      annotations: READ,
    },
    () => reply('which_pedal', options, async () => describePedals(await (options.midiPorts ?? noMatribox)())),
  );

  server.registerTool(
    'matribox_list_presets',
    {
      title: 'List Matribox presets',
      description: 'Matribox II Pro: the 240 presets by bank label (1A..60D, four per bank) with their style tags, the loaded one marked with *.',
      annotations: READ,
    },
    () => reply('matribox_list_presets', options, () => matribox().listPresets()),
  );

  server.registerTool(
    'matribox_get_preset',
    {
      title: 'Get the loaded Matribox preset',
      description: 'Matribox II Pro: the loaded preset: name, chain in signal order, and each block with its model, the real gear the model is based on, on/off and its parameters with their ranges.',
      annotations: READ,
    },
    () => reply('matribox_get_preset', options, () => matribox().describe()),
  );

  server.registerTool(
    'matribox_list_models',
    {
      title: 'List the Matribox models',
      description:
        'Matribox II Pro: every model of a module (or of all 16), with the real gear it is based on, a short description and its parameters with ranges. Read from the official Matribox II PRO app installed on this computer. Call it once without module to learn the palette before planning a tone.',
      inputSchema: { module: z.string().optional().describe('Module name: DYN, FREQ, WAH, DRV, AMP, CAB, IR, EQ, MOD, DLY, RVB, CLONE, FXLOOP, FXSND, FXRTN or VOL') },
      annotations: READ,
    },
    ({ module }) => reply('matribox_list_models', options, () => matribox().listModels(module)),
  );

  server.registerTool(
    'matribox_list_irs',
    {
      title: 'List the Matribox user IRs',
      description: 'Matribox II Pro: the names of the 20 user IR slots.',
      annotations: READ,
    },
    () => reply('matribox_list_irs', options, () => matribox().listIrs()),
  );

  server.registerTool(
    'matribox_list_captures',
    {
      title: 'List the Matribox captures',
      description: 'Matribox II Pro: the names of the 10 capture (clone) slots the CLONE module plays.',
      annotations: READ,
    },
    () => reply('matribox_list_captures', options, () => matribox().listCaptures()),
  );

  registerMatriboxWrites(server, options, matribox);
  registerMatriboxLive(server, (tool, run) => reply(tool, options, run), matribox);
}

const MB_EXPERIMENTAL = 'Experimental: validated on one unit only so far; check the result with matribox_get_preset.';
const mbBlock = z.string().describe('Block of the loaded preset: its 1-based position in the chain ("2") or its module name ("DRV") when the chain has only one');
const mbModule = z.string().describe('Module name: DYN, FREQ, WAH, DRV, AMP, CAB, IR, EQ, MOD, DLY, RVB, CLONE, FXLOOP, FXSND, FXRTN or VOL');
const mbPreset = z.string().describe('Preset label, 1A..60D (four per bank)');
const mbLive = (what: string) => `Matribox II Pro: ${what} The change is live in the loaded preset; nothing is stored until matribox_save_preset. ${MB_EXPERIMENTAL}`;
const mbPickModels = 'Pick models by their origin (the real gear they are based on) from matribox_list_models.';

/** The Matribox II Pro's writes: live edits of the loaded preset, select, and save (confirmed, with a backup). */
function registerMatriboxWrites(server: McpServer, options: ServerOptions, matribox: () => MatriboxSession): void {
  server.registerTool(
    'matribox_set_param',
    {
      title: 'Set a Matribox parameter',
      description: mbLive("sets one parameter of a block by its name as matribox_get_preset shows it, within the model's range."),
      inputSchema: { block: mbBlock, parameter: z.string().describe('Parameter name, e.g. "Gain"'), value: z.number().describe("A value in the parameter's range") },
      annotations: LIVE,
    },
    (args) => reply('matribox_set_param', options, () => matribox().setParam(args)),
  );

  server.registerTool(
    'matribox_set_module_on',
    {
      title: 'Turn a Matribox block on or off',
      description: mbLive('turns one block of the loaded preset on or off.'),
      inputSchema: { block: mbBlock, on: z.boolean() },
      annotations: LIVE,
    },
    (args) => reply('matribox_set_module_on', options, () => matribox().setBlockOn(args)),
  );

  server.registerTool(
    'matribox_select_preset',
    {
      title: 'Load a Matribox preset',
      description: `Matribox II Pro: loads a preset by label. Unsaved changes to the loaded preset are lost: ask the user first. ${MB_EXPERIMENTAL}`,
      inputSchema: { preset: mbPreset },
      annotations: LIVE,
    },
    (args) => reply('matribox_select_preset', options, () => matribox().selectPreset(args)),
  );

  server.registerTool(
    'matribox_set_model',
    {
      title: 'Change the model of a Matribox block',
      description: mbLive(`swaps the model in one block and sets all its parameters to the model's defaults. ${mbPickModels}`),
      inputSchema: { block: mbBlock, model: z.string().describe('Model name from matribox_list_models') },
      annotations: LIVE,
    },
    (args) => reply('matribox_set_model', options, () => matribox().setModel(args)),
  );

  server.registerTool(
    'matribox_add_block',
    {
      title: 'Add a block to the Matribox chain',
      description: mbLive(`inserts one block (module + model) at a 1-based chain position, the end by default; parameters not given get the model's default. ${mbPickModels}`),
      inputSchema: {
        module: mbModule,
        model: z.string().describe('Model name of that module, from matribox_list_models'),
        position: z.number().int().optional().describe('1-based position in the chain; default: after the last block'),
        on: z.boolean().optional().describe('Default true'),
        params: z.record(z.string(), z.number()).optional().describe('Parameter name → value, within the ranges matribox_list_models gives'),
      },
      annotations: LIVE,
    },
    (args) => reply('matribox_add_block', options, () => matribox().addBlock(args)),
  );

  server.registerTool(
    'matribox_remove_block',
    {
      title: 'Remove a block from the Matribox chain',
      description: mbLive("removes one block of the loaded preset's chain."),
      inputSchema: { block: mbBlock },
      annotations: LIVE,
    },
    (args) => reply('matribox_remove_block', options, () => matribox().removeBlock(args)),
  );

  server.registerTool(
    'matribox_move_block',
    {
      title: 'Move a block in the Matribox chain',
      description: mbLive('moves one block to another 1-based position in the chain (signal order).'),
      inputSchema: { block: mbBlock, to: z.number().int().describe('New 1-based position in the chain') },
      annotations: LIVE,
    },
    (args) => reply('matribox_move_block', options, () => matribox().moveBlock(args)),
  );

  server.registerTool(
    'matribox_build_tone',
    {
      title: 'Build a whole Matribox tone',
      description: mbLive(
        `replaces the loaded preset's chain with these blocks in signal order (input to output, at most 12), each with its model and parameters; parameters not given get the model's default. ${mbPickModels} To match a reference, work out the gear used (pedals, amp, cab, effects) and choose the models whose origin matches. The unit may drop expression-pedal and footswitch assignments that named removed blocks.`,
      ),
      inputSchema: {
        blocks: z
          .array(
            z.object({
              module: mbModule,
              model: z.string().describe('Model name of that module, from matribox_list_models'),
              on: z.boolean().optional().describe('Default true'),
              params: z.record(z.string(), z.number()).optional().describe('Parameter name → value, within the ranges matribox_list_models gives'),
            }),
          )
          .min(1)
          .describe('The chain in signal order'),
      },
      annotations: LIVE,
    },
    (args) => reply('matribox_build_tone', options, () => matribox().buildTone(args)),
  );

  server.registerTool(
    'matribox_save_preset',
    {
      title: 'Save the loaded Matribox preset',
      description: `Matribox II Pro: stores the loaded preset in a preset slot under a name, overwriting it. Only call it when the user asked for that slot, and pass its label as confirm. The slot is backed up to ~/.pocket-master-editor/backups first. Over another slot, that slot is loaded to back it up (the unit only shows what a slot stores once loaded), the loaded preset with its edits is written into it whole, and it stays loaded; over the loaded slot the backup is the preset as loaded. The save is checked by reading the slot back. ${MB_EXPERIMENTAL}`,
      inputSchema: { preset: mbPreset, name: z.string().describe('1..16 printable ASCII characters'), confirm: z.string().describe('The same label as preset, to confirm the overwrite') },
      annotations: WRITE_SLOT,
    },
    (args) => reply('matribox_save_preset', options, () => matribox().savePreset(args)),
  );

  registerMatriboxFiles(server, options, matribox);
}

const MB_UNCHECKED =
  "Experimental: the whole-preset write is decoded from the official editor's traffic and not yet checked on the owner's unit; check the result with matribox_get_preset and by ear.";
const MB_WHOLE =
  "The whole preset is stored in the slot with one write, as Sonicake's own app imports a .prst: chain, parameters, on/off, knob, expression-pedal and footswitch assignments, volume and tempo. The unit keeps it in that slot at once (no save needed) and loads that slot; what the slot held is backed up first.";

/** .prst export and import, and restoring a save_preset backup: a whole preset applied with the live-edit writes. */
function registerMatriboxFiles(server: McpServer, options: ServerOptions, matribox: () => MatriboxSession): void {
  server.registerTool(
    'matribox_export_preset',
    {
      title: 'Export a Matribox preset to a .prst file',
      description: `Matribox II Pro: writes the loaded preset (unsaved edits included), or a stored slot, as a .prst file (the format of Sonicake's own app) inside ~/.pocket-master-editor/presets/matribox. A slot that is not loaded is loaded to read it, then the original preset again: its unsaved edits are lost. Never overwrites a file. Experimental: whether Sonicake's own app opens the .prst it writes is not yet checked.`,
      inputSchema: {
        preset: mbPreset.optional().describe('Preset label 1A..60D to export; default: the loaded preset with its unsaved edits'),
        file: z.string().optional().describe('File name ending in .prst inside ~/.pocket-master-editor/presets/matribox; default: label, name and time'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (args) => reply('matribox_export_preset', options, () => matribox().exportPreset(args)),
  );

  server.registerTool(
    'matribox_import_preset',
    {
      title: 'Load a Matribox .prst file',
      description: `Matribox II Pro: stores a .prst file from ~/.pocket-master-editor/presets/matribox in a preset slot, overwriting it. Only call it when the user asked for that slot; confirm repeats its label. Unsaved edits of the loaded preset are lost (the slot becomes the loaded preset). ${MB_WHOLE} ${MB_UNCHECKED}`,
      inputSchema: {
        file: z.string().describe('.prst file name inside ~/.pocket-master-editor/presets/matribox'),
        preset: mbPreset.describe('Slot to store it in, 1A..60D'),
        name: z.string().optional().describe("Name for the slot, 1..16 printable ASCII characters; default: the file's preset name"),
        confirm: z.string().describe('The same label as preset, to confirm the overwrite'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('matribox_import_preset', options, () => matribox().importPreset(args)),
  );

  server.registerTool(
    'matribox_load_ir',
    {
      title: 'Load a WAV into a Matribox user IR slot',
      description:
        'Matribox II Pro: writes a cabinet impulse response (WAV, 44.1 or 48 kHz) from ~/.pocket-master-editor/irs into user IR slot 1..20, converted the way Sonicake\'s editor does (1024 samples at 44.1 kHz). The unit cannot send an IR back, so an occupied slot (its name is not the default "User IR n") is only overwritten with replace: true. Only call it when the user asked for that slot; matribox_list_irs shows the slots. Experimental: rebuilt byte for byte from the official editor\'s uploads, not yet checked on a unit.',
      inputSchema: {
        file: z.string().describe('WAV file name inside ~/.pocket-master-editor/irs'),
        slot: z.number().int().min(1).max(20).describe('User IR slot 1..20'),
        confirm: z.string().describe('Must be "IR<slot>", e.g. "IR7", confirming the user asked to write that slot'),
        name: z.string().max(16).optional().describe('Name shown on the unit, 1..16 printable ASCII characters; default: the file name cut to 16'),
        replace: z.boolean().default(false).describe('Overwrite a slot that already holds an IR (it cannot be backed up)'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('matribox_load_ir', options, () => matribox().loadIr(args)),
  );

  server.registerTool(
    'matribox_restore_backup',
    {
      title: 'Restore a Matribox backup',
      description: `Matribox II Pro: puts a backup that matribox_save_preset wrote (in ~/.pocket-master-editor/backups) back into its slot (that slot is backed up again first, and becomes the loaded preset). Only call it when the user asked; confirm repeats the backup's slot label. ${MB_WHOLE} ${MB_UNCHECKED}`,
      inputSchema: {
        file: z.string().describe('Backup file name inside ~/.pocket-master-editor/backups, as matribox_save_preset returned it'),
        confirm: z.string().describe('The backup\'s slot label, e.g. "17C", to confirm the overwrite'),
        name: z.string().optional().describe("Name for the save, 1..16 printable ASCII characters; default: the backup's name"),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('matribox_restore_backup', options, () => matribox().restoreBackup(args)),
  );

  server.registerTool(
    'matribox_backup_all_presets',
    {
      title: 'Back up all 240 Matribox presets',
      description: `Matribox II Pro: reads all 240 presets (1A..60D) into one JSON file in ~/.pocket-master-editor/backups, for matribox_restore_all_presets. The unit only shows what a slot stores once it is loaded, so each slot is loaded in turn and the preset that was loaded is loaded again at the end: its unsaved edits are lost (save them first). Writes nothing to the presets. Never overwrites a file.`,
      inputSchema: { file: z.string().optional().describe('File name ending in .json inside ~/.pocket-master-editor/backups; default: time + "matribox-all"') },
      annotations: LIVE,
    },
    (args) => reply('matribox_backup_all_presets', options, () => matribox().backupAllPresets(args)),
  );

  server.registerTool(
    'matribox_restore_all_presets',
    {
      title: 'Restore all Matribox presets from a backup-all file',
      description: `Matribox II Pro: writes every preset of a matribox_backup_all_presets file (in ~/.pocket-master-editor/backups) back into its own slot, overwriting them, each checked by reading it back; it stops at the first failure and says which slots were written. First (unless backup is false) all 240 presets are backed up to a new file, so it can be undone. Only call it when the user asked to restore everything; confirm must be "ALL". Unsaved edits of the loaded preset are lost; that preset is loaded again at the end. ${MB_UNCHECKED}`,
      inputSchema: {
        file: z.string().describe('Backup-all file name inside ~/.pocket-master-editor/backups, as matribox_backup_all_presets returned it'),
        confirm: z.string().describe('"ALL", to confirm overwriting every preset in the file'),
        backup: z.boolean().optional().describe('Back up all 240 presets first (default true)'),
      },
      annotations: WRITE_SLOT,
    },
    (args) => reply('matribox_restore_all_presets', options, () => matribox().restoreAllPresets(args)),
  );
}
