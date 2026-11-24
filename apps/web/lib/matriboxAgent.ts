/**
 * The tone assistant on the Matribox II Pro. The model picks models by the real gear they are based
 * on (the person's own alg_data.json) and sends a whole chain or small edits; the editor checks
 * them against the catalog and sends them through its validated writes as one Undo step. Saving
 * only opens the editor's Save dialog.
 */
import { CHAT_INSTRUCTIONS_THOROUGH, checkMbPresetName, mbPresetLabel, parseMbPresetLabel, type ChatTool, type JsonSchema, type MbCatalog, type MbPreset } from '@pocket-master/core';
import { SAVE_VERB, type ToneAgent } from './assistant.ts';
import { editChain, planTone, type ChainChange, type MbChainBlock, type ToneBlock } from './matriboxPlan.ts';
import { mbCatalogText, mbChanges, mbModelsText, mbPresetText } from './matriboxText.ts';

/** What the assistant needs from the Matribox editor; every method works on its current state. */
export interface MbAgentHost {
  snapshot(): { readonly current: number; readonly preset: MbPreset; readonly catalog: MbCatalog };
  /** Sends the chain as one Undo step; resolves with the preset as the unit has it, throws when refused. */
  apply(chain: readonly MbChainBlock[]): Promise<MbPreset>;
  /** The editor's Undo; false when there is nothing to undo. */
  undo(): Promise<boolean>;
  /** Opens the Save dialog filled in; resolves with what the person did. */
  proposeSave(index: number, name: string): Promise<'saved' | 'cancelled'>;
}

const object = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: 'object', properties, required });
const kind = (k: string): JsonSchema => ({ type: 'string', const: k });
const BLOCK: JsonSchema = { type: 'string', description: 'Block of the loaded preset: its 1-based chain position ("2"), or its module name ("DRV") when the chain has only one' };
const MODULE: JsonSchema = { type: 'string', description: 'Module name: DYN, FREQ, WAH, DRV, AMP, CAB, IR, EQ, MOD, DLY, RVB, CLONE, FXLOOP, FXSND, FXRTN or VOL' };
const MODEL: JsonSchema = { type: 'string', description: 'Model name of that module, as the catalog lists it' };
const PARAMS: JsonSchema = {
  type: 'array',
  description: "Values within the ranges list_models gives; parameters not given take the model's default",
  items: object({ name: { type: 'string', description: 'Parameter name, e.g. "Gain"' }, value: { type: 'number' } }, ['name', 'value']),
};
const TONE_BLOCK = object({ module: MODULE, model: MODEL, on: { type: 'boolean', description: 'Default true' }, params: PARAMS }, ['module', 'model']);
const CHANGE: JsonSchema = {
  oneOf: [
    object({ kind: kind('parameter'), block: BLOCK, parameter: { type: 'string', description: "Parameter name of the block's model" }, value: { type: 'number' } }, [
      'kind',
      'block',
      'parameter',
      'value',
    ]),
    object({ kind: kind('block'), block: BLOCK, on: { type: 'boolean' } }, ['kind', 'block', 'on']),
    object({ kind: kind('model'), block: BLOCK, model: MODEL }, ['kind', 'block', 'model']),
    object({ kind: kind('add'), module: MODULE, model: MODEL, position: { type: 'integer', description: '1-based chain position; default: the end' }, on: { type: 'boolean' }, params: PARAMS }, [
      'kind',
      'module',
      'model',
    ]),
    object({ kind: kind('remove'), block: BLOCK }, ['kind', 'block']),
    object({ kind: kind('move'), block: BLOCK, position: { type: 'integer', description: 'New 1-based chain position' } }, ['kind', 'block', 'position']),
  ],
};
const NONE: JsonSchema = { type: 'object', properties: {} };

const TOOLS: readonly ChatTool[] = [
  {
    name: 'get_preset',
    description: "The preset loaded on the Matribox: name, chain in signal order, each block's model, the gear it is based on, on/off and parameter values with ranges.",
    parameters: NONE,
  },
  {
    name: 'list_models',
    description: "The models of the modules asked for (all when none), with the gear each is based on and every parameter's range and default.",
    parameters: object({ modules: { type: 'array', items: MODULE } }, []),
  },
  {
    name: 'build_tone',
    description:
      "Replaces the loaded preset's chain with these blocks, in signal order (input to output, 1 to 12), each with its model, on/off and values. Live only: nothing is saved. Everything is checked before anything is sent. Returns the preset as it now is.",
    parameters: object({ blocks: { type: 'array', items: TONE_BLOCK } }, ['blocks']),
  },
  {
    name: 'edit_preset',
    description:
      'Small changes to the loaded preset, applied in order (each names blocks as the chain is after the changes before it); a new model starts at its defaults. Live only: nothing is saved. Returns the preset as it now is.',
    parameters: object({ changes: { type: 'array', items: CHANGE } }, ['changes']),
  },
  { name: 'undo_edit', description: "Undoes the last change to the sound (the editor's Undo, also the person's own edits). Nothing is saved.", parameters: NONE },
  {
    name: 'save_preset',
    description:
      'Proposes saving the sound to a preset slot under a name: the editor opens its Save dialog filled in, backs the slot up and saves only if the person confirms. Only when the person asked to save.',
    parameters: object({ slot: { type: 'string', description: 'Preset label, 1A..60D (four per bank)' }, name: { type: 'string', description: 'Preset name, 1..16 printable ASCII characters' } }, [
      'slot',
      'name',
    ]),
  },
];

/** The tools that change the sound (or open the Save dialog). */
const ACTS = new Set(['build_tone', 'edit_preset', 'undo_edit', 'save_preset']);

const INSTRUCTIONS = [
  'You are the tone assistant of an editor for the Sonicake Matribox II Pro guitar multi-effects. The person usually describes a sound (an artist, a record, a song, or words like "warmer").',
  'Work out the gear used on the reference (pedals, amp, cabinet, effects) and pick the models whose origin, the real gear they are based on, matches it: the first message lists every model with its origin. Then build the whole chain with one build_tone, in signal order, with sensible values; call list_models first for the modules whose parameters you set, or leave them at their defaults.',
  'For adjustments ("warmer", "less gain") use edit_preset. Values must be within the ranges given. Say what you did in the same terms as the values.',
  'Do not ask for details the person did not give: make reasonable choices, say briefly what you chose and why, naming the real gear, and invite them to ask for adjustments by ear.',
  'The editor shows every change live, and the person can undo. Nothing is stored until save_preset, which opens the editor\'s Save dialog for the person to confirm; propose it only when the person asks to save (e.g. "on 12A"). Never say a tone is saved unless save_preset answered that the person saved it.',
  'Use as few calls as possible: build_tone and edit_preset already return the resulting preset. Answer in the language the person writes in, in two to four short sentences.',
].join(' ');

const LABEL = /\b(\d{1,2})\s?([a-d])\b/i;

/** The preset (0-based) a message asks to save in ("salva no 12A", "save it to 1D"), or null. */
export function askedToSaveMb(message: string): number | null {
  const label = SAVE_VERB.test(message) ? LABEL.exec(message) : null;
  if (!label) return null;
  try {
    return parseMbPresetLabel(`${label[1]}${label[2]}`);
  } catch {
    return null; // "61A" is not a preset
  }
}

const field = (args: unknown, name: string): unknown => (typeof args === 'object' && args !== null ? (args as Record<string, unknown>)[name] : undefined);

async function run(host: MbAgentHost, name: string, args: unknown): Promise<string> {
  const { preset, catalog } = host.snapshot();
  const now = (p: MbPreset) => mbPresetText(p, catalog);
  switch (name) {
    case 'get_preset':
      return now(preset);
    case 'list_models':
      return mbModelsText(catalog, field(args, 'modules') as string[] | undefined);
    case 'build_tone': {
      const blocks = field(args, 'blocks');
      if (!Array.isArray(blocks)) throw new Error('blocks must be a list');
      return now(await host.apply(planTone(catalog, blocks as ToneBlock[])));
    }
    case 'edit_preset':
      return now(await host.apply(editChain(catalog, preset.chain, field(args, 'changes') as ChainChange[])));
    case 'undo_edit':
      if (!(await host.undo())) throw new Error('there is nothing to undo.');
      return now(host.snapshot().preset);
    case 'save_preset': {
      const index = parseMbPresetLabel(String(field(args, 'slot') ?? ''));
      const presetName = checkMbPresetName(String(field(args, 'name') ?? ''));
      const label = mbPresetLabel(index);
      const done = await host.proposeSave(index, presetName);
      return done === 'saved' ? `The person saved it to ${label} "${presetName}".` : `The person closed the Save dialog without saving; ${label} is unchanged.`;
    }
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

export function matriboxAgent(host: MbAgentHost): ToneAgent {
  const presetText = () => {
    const s = host.snapshot();
    return mbPresetText(s.preset, s.catalog);
  };
  return {
    tools: TOOLS,
    acts: ACTS,
    instructions: (thorough) => (thorough ? `${INSTRUCTIONS} ${CHAT_INSTRUCTIONS_THOROUGH}` : INSTRUCTIONS),
    context: (thorough) => `Loaded preset:\n${presetText()}\n\nModels by module (name, then the gear it is based on):\n${mbCatalogText(host.snapshot().catalog, thorough)}`,
    current: presetText,
    runner: () => {
      // The preset this message works on: the person loading another one stops the sound changes.
      let working = host.snapshot().current;
      return async (name, args) => {
        const s = host.snapshot();
        if (name === 'get_preset') working = s.current;
        if (ACTS.has(name) && s.current !== working) {
          return {
            ok: false,
            text: `Error: the preset changed to ${mbPresetLabel(s.current)} "${s.preset.name}" while you were working (the person loaded it). Call get_preset and check the request still applies before changing anything.`,
          };
        }
        try {
          return { ok: true, text: await run(host, name, args) };
        } catch (error) {
          return { ok: false, text: `Error: ${error instanceof Error ? error.message : String(error)}` };
        }
      };
    },
    watch: (off) => {
      const before = host.snapshot();
      return (moved) => {
        const after = host.snapshot();
        return before.current !== after.current && !moved.saved ? undefined : mbChanges(before.preset, after.preset, after.catalog, off);
      };
    },
    offerSave: (message) => {
      const index = askedToSaveMb(message);
      if (index === null) return null;
      void host.proposeSave(index, host.snapshot().preset.name.trim());
      return mbPresetLabel(index);
    },
  };
}
