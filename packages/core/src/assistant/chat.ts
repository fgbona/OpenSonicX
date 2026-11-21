/**
 * The tone tools as the editor's chat offers them to a model, and their runner. The editor
 * implements ToneHost on its own state, so the model's edits are the editor's edits: they show on
 * screen, go through its busy lock and Undo/Redo, and saving opens its Save dialog. Parameters of
 * the tools shared with the MCP server match its frozen contract (apps/mcp/test/fixtures).
 */
import type { Preset } from '../dump.ts';
import type { Edit } from '../edit.ts';
import { applyEdit } from '../edit.ts';
import { presetLabel, USER_PRESETS } from '../presets.ts';
import { parsePresetLabel, resolveBlock, type SlotNames } from '../resolve.ts';
import { encodeName } from '../slots.ts';
import { toEdit, type Change } from './change.ts';
import { formatModels, formatPreset } from './format.ts';

export interface ToneSnapshot {
  readonly index: number;
  readonly name: string;
  readonly preset: Preset;
  readonly slots: SlotNames;
  readonly modified: boolean | null;
  /** Names of the 100 presets. */
  readonly names: readonly string[];
}

/** What the chat needs from the editor. Every method reads or acts on the editor's current state. */
export interface ToneHost {
  snapshot(): ToneSnapshot;
  /** Sends edits as one step; throws a readable Error when the editor refuses (live edit off, busy). */
  applyEdits(edits: readonly Edit[]): Promise<void>;
  /** The editor's Undo; false when there is nothing to undo. */
  undo(): Promise<boolean>;
  revert(): Promise<void>;
  /** Loads a preset through the editor's own confirmation; false when the person kept the current one. */
  selectPreset(index: number): Promise<boolean>;
  /** Opens the Save dialog filled in; resolves with what the person did. */
  proposeSave(index: number, name: string): Promise<'saved' | 'cancelled'>;
}

export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly oneOf?: readonly JsonSchema[];
  readonly const?: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ChatTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

const BLOCK: JsonSchema = { type: 'string', description: 'Block label: NR, FX1, DRV, AMP, IR, EQ, FX2, DLY or RVB' };
const SLOT: JsonSchema = { type: 'string', description: 'Preset label, e.g. "P09" (user presets are P01..P50, factory presets F01..F50)' };
const NONE: JsonSchema = { type: 'object', properties: {} };
const object = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: 'object', properties, required });
const kind = (k: string): JsonSchema => ({ type: 'string', const: k });

const CHANGE: JsonSchema = {
  oneOf: [
    object({
      kind: kind('parameter'), block: BLOCK,
      parameter: { type: 'string', description: 'Parameter name of the block\'s current model, as get_preset shows it (e.g. "Gain")' },
      value: { type: ['number', 'boolean', 'string'], description: 'A number in the parameter\'s range, true/false for a switch, or an option name' },
    }, ['kind', 'block', 'parameter', 'value']),
    object({ kind: kind('block'), block: BLOCK, on: { type: 'boolean' } }, ['kind', 'block', 'on']),
    object({ kind: kind('model'), block: BLOCK, model: { type: 'string', description: 'Model name from list_models; for AMP, a captured profile name selects clone mode' } }, ['kind', 'block', 'model']),
    object({ kind: kind('move'), block: BLOCK, position: { type: 'integer', description: '1-based position in the chain; DRV, AMP, IR and EQ move together' } }, ['kind', 'block', 'position']),
    object({ kind: kind('volume'), value: { type: 'integer', minimum: 0, maximum: 100, description: 'Preset volume 0..100' } }, ['kind', 'value']),
  ],
};

export const CHAT_TOOLS: readonly ChatTool[] = [
  { name: 'get_preset', description: 'The preset loaded on the pedal: name, volume, amp mode, unsaved-changes flag, chain order and every block with its model, on/off state and parameter values.', parameters: NONE },
  { name: 'list_presets', description: 'Names of all 100 presets (P01..P50 user, F01..F50 factory).', parameters: NONE },
  { name: 'list_models', description: 'Every model a block can use (or, without block, of every block), with the real gear it is based on, a short description and its parameters with ranges. The first message already lists them all; call it only if you need them again.', parameters: object({ block: BLOCK }, []) },
  { name: 'edit_preset', description: 'Changes the sound right away, in the edit buffer only (nothing is saved). Changes apply in order and are all checked before any is sent, so a model change can be followed by that model\'s parameters. Names are matched ignoring case; an unknown or ambiguous name fails with the valid choices. Returns the preset as it now is.', parameters: object({ changes: { type: 'array', items: CHANGE } }, ['changes']) },
  { name: 'undo_edit', description: 'Undoes the last change to the sound (the editor\'s Undo, also the person\'s own knob turns). Call it again to go further back. Nothing is saved.', parameters: NONE },
  { name: 'revert_preset', description: 'Reloads the loaded preset from its slot, discarding every unsaved change.', parameters: NONE },
  { name: 'select_preset', description: 'Loads a preset, like turning the preset knob. If the current one has unsaved changes the editor asks the person first.', parameters: object({ preset: SLOT }, ['preset']) },
  { name: 'save_preset', description: 'Proposes saving the sound to a user slot (P01..P50) under a name: the editor opens its Save dialog filled in, backs the slot up and saves only if the person confirms. Only when the person asked to save.', parameters: object({ slot: SLOT, name: { type: 'string', description: 'Preset name, 1..10 printable ASCII characters' } }, ['slot', 'name']) },
];

export const CHAT_INSTRUCTIONS = [
  'You are the tone assistant of an editor for the Sonicake Pocket Master guitar pedal. The person usually describes a sound (an artist, a record, a song, or words like "warmer").',
  'Work out the gear used on the reference and pick the pedal models based on it (model names are disguised, e.g. "Calif DualM" is a Mesa/Boogie Dual Rectifier; the first message lists every model with what it is based on), then build the whole chain with one edit_preset: drive, amp, cabinet, EQ, gate, modulation, delay and reverb, with sensible values.',
  'Do not ask for details the person did not give: make reasonable choices, say briefly what you chose and why, and invite them to ask for adjustments by ear.',
  'The editor shows every change live, and the person can undo. Nothing is stored until save_preset, which opens the editor\'s Save dialog for the person to confirm; propose it only when the person asks to save (e.g. "no 45" means slot P45).',
  'Use as few calls as possible: edit_preset already returns the resulting preset. Answer in the language the person writes in, in two to four short sentences.',
].join(' ');

/** The first message's context: the preset and every block's models, so a tone needs one or two requests. */
export function chatContext(host: ToneHost): string {
  const s = host.snapshot();
  const models = s.preset.chain.map((b) => formatModels(b.key, b.label, s.slots)).join('\n\n');
  return `Loaded preset:\n${preset(s)}\n\n${models}`;
}

const preset = (s: ToneSnapshot) => formatPreset(s.index, s.name, s.preset, s.slots, s.modified);

/** The loaded preset as the model reads it, for messages after the first. */
export function currentPresetText(host: ToneHost): string {
  return preset(host.snapshot());
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (args: Record<string, unknown>, key: string, optional = false): string | undefined => {
  const v = args[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${key} must be a non-empty string`);
  return v;
};

/** A change as the model sent it, checked for shape; names are checked by toEdit. */
function asChange(v: unknown): Change {
  if (!isRecord(v)) throw new Error('each change must be an object');
  const block = () => str(v, 'block') as string;
  const value = v.value;
  switch (v.kind) {
    case 'parameter':
      if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') throw new Error('value must be a number, true/false or an option name');
      return { kind: 'parameter', block: block(), parameter: str(v, 'parameter') as string, value };
    case 'block':
      if (typeof v.on !== 'boolean') throw new Error('on must be true or false');
      return { kind: 'block', block: block(), on: v.on };
    case 'model':
      return { kind: 'model', block: block(), model: str(v, 'model') as string };
    case 'move':
      if (typeof v.position !== 'number') throw new Error('position must be a number');
      return { kind: 'move', block: block(), position: v.position };
    case 'volume':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new Error('volume must be an integer 0..100');
      return { kind: 'volume', value };
    default:
      throw new Error('kind must be parameter, block, model, move or volume');
  }
}

/**
 * The preset a reply is working on. When the person loads another one meanwhile, the tools that
 * change the sound refuse until the model has looked at the preset again (get_preset).
 */
export interface ChatGuard {
  index: number;
}

const CHANGES_SOUND = new Set(['edit_preset', 'undo_edit', 'revert_preset']);

async function run(host: ToneHost, name: string, args: Record<string, unknown>, guard?: ChatGuard): Promise<{ ok: boolean; text: string }> {
  const done = (text: string) => ({ ok: true, text });
  if (guard && CHANGES_SOUND.has(name)) {
    const s = host.snapshot();
    if (s.index !== guard.index) {
      return { ok: false, text: `Error: the preset changed to ${presetLabel(s.index)} "${s.name}" while you were working (the person loaded it). Call get_preset and check the request still applies before changing anything.` };
    }
  }
  switch (name) {
    case 'get_preset': {
      const s = host.snapshot();
      if (guard) guard.index = s.index;
      return done(preset(s));
    }
    case 'list_presets':
      return done(host.snapshot().names.map((n, i) => `${presetLabel(i)} ${n}`).join('\n'));
    case 'list_models': {
      const s = host.snapshot();
      const label = str(args, 'block', true);
      const blocks = label === undefined ? s.preset.chain : [resolveBlock(s.preset, label)];
      return done(blocks.map((b) => formatModels(b.key, b.label, s.slots)).join('\n\n'));
    }
    case 'edit_preset': {
      if (!Array.isArray(args.changes) || args.changes.length === 0 || args.changes.length > 50) throw new Error('changes must be a list of 1..50 changes');
      const s = host.snapshot();
      // Every change is checked against the preset as the earlier ones leave it, before any is sent.
      const { edits } = args.changes.map(asChange).reduce(
        (acc, change) => { const edit = toEdit(acc.preset, change, s.slots); return { preset: applyEdit(acc.preset, edit), edits: [...acc.edits, edit] }; },
        { preset: s.preset, edits: [] as Edit[] },
      );
      await host.applyEdits(edits);
      return done(preset(host.snapshot()));
    }
    case 'undo_edit':
      if (!(await host.undo())) return done('Nothing to undo: no change since the preset was loaded.');
      return done(`Undid the last change.\n\n${preset(host.snapshot())}`);
    case 'revert_preset':
      await host.revert();
      return done(`Reverted to the saved preset.\n\n${preset(host.snapshot())}`);
    case 'select_preset': {
      const index = parsePresetLabel(str(args, 'preset') as string);
      if (!(await host.selectPreset(index))) return { ok: false, text: `The person kept the current preset (it has unsaved changes), so ${presetLabel(index)} was not loaded.` };
      const s = host.snapshot();
      if (guard) guard.index = s.index;
      return done(preset(s));
    }
    case 'save_preset': {
      const index = parsePresetLabel(str(args, 'slot') as string);
      if (index >= USER_PRESETS) throw new Error(`only user presets P01..P${USER_PRESETS} can be saved`);
      const presetName = (str(args, 'name') as string).trim();
      encodeName(presetName); // throws on a name the pedal cannot store
      const outcome = await host.proposeSave(index, presetName);
      return done(outcome === 'saved'
        ? `Saved to ${presetLabel(index)} as "${presetName}", confirmed by the person in the Save dialog (the slot was backed up first).`
        : `The person closed the Save dialog: ${presetLabel(index)} was left as it was, so they did not save.`);
    }
    default:
      return { ok: false, text: `Error: unknown tool ${name}` };
  }
}

/** Runs a tool call from the model. Never throws: errors come back as text the model can act on. */
export async function runChatTool(host: ToneHost, name: string, args: unknown, guard?: ChatGuard): Promise<{ ok: boolean; text: string }> {
  try {
    if (!CHAT_TOOLS.some((t) => t.name === name)) return { ok: false, text: `Error: unknown tool ${name}` };
    return await run(host, name, isRecord(args) ? args : {}, guard);
  } catch (error) {
    return { ok: false, text: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}
