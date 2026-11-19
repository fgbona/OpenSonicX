import { modelsFor, type ParamSpec } from './catalog.ts';
import { modelOf, type Block, type Preset } from './dump.ts';
import { modelInfo } from './model-info.ts';
import { effectiveSpec } from './sync.ts';
import { USER_PRESETS } from './presets.ts';
import { userIrSlot } from './slots.ts';

/** Names loaded in the pedal's user slots (null for an empty slot, or null when not read). */
export interface SlotNames {
  readonly irNames: readonly (string | null)[] | null;
  readonly profileNames: readonly (string | null)[] | null;
}

/** A model a block can take, named as a musician would see it. */
export interface ModelChoice {
  readonly name: string;
  readonly code: number;
  /** A captured profile (AMP in clone mode). */
  readonly clone: boolean;
  /** The real gear the manual says the model is based on, when it names one. */
  readonly basedOn?: string;
}

const normalize = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, '');

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);

/**
 * The one choice whose name (or alias) equals `input`, else the one it is a unique prefix of,
 * else the one whose words (names or `also`, e.g. the gear a model is based on) contain every
 * word of `input`. Never guesses: no match or several matches throw an error listing them.
 */
function pick<T>(
  what: string,
  input: string,
  choices: readonly { names: readonly string[]; value: T; label: string; also?: string }[],
): T {
  const key = normalize(input);
  const wanted = words(input);
  const tiers = [
    (c: (typeof choices)[number]) => c.names.some((n) => normalize(n) === key),
    (c: (typeof choices)[number]) => c.names.some((n) => normalize(n).startsWith(key)),
    (c: (typeof choices)[number]) => {
      const have = new Set(words([...c.names, c.also ?? ''].join(' ')));
      return wanted.length > 0 && wanted.every((w) => have.has(w));
    },
  ];
  const found = tiers.map((match) => choices.filter(match)).find((matches) => matches.length > 0) ?? [];
  if (key && found.length === 1) return found[0]!.value;
  if (found.length > 1) throw new Error(`"${input.trim()}" matches several ${what}s: ${found.map((c) => c.label).join(', ')}`);
  throw new Error(`No ${what} "${input.trim()}". ${capitalize(what)}s: ${choices.map((c) => c.label).join(', ')}`);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A block of the preset by label ("AMP") or key ("amp"). */
export function resolveBlock(preset: Preset, input: string): Block {
  return pick('block', input, preset.chain.map((b) => ({ names: [b.label, b.key], value: b, label: b.label })));
}

/** A parameter of the block's current model by name or unique prefix. */
export function resolveParam(preset: Preset, block: Block, input: string): ParamSpec {
  const params = modelOf(preset, block)?.params ?? [];
  if (params.length === 0) throw new Error(`${block.label} has an unknown model (${block.model}); its parameters cannot be set by name`);
  const spec = pick('parameter', input, params.map((p) => ({ names: [p.name], value: p, label: p.name })));
  // As the pedal reads the slot now: a synced Time or Rate takes a note division.
  return effectiveSpec(spec, (alg) => block.params.find((p) => p.alg === alg)?.value);
}

/** Every model a block can take: catalog names, user IRs by their file names, AMP adds loaded profiles. */
export function modelChoices(blockKey: string, slots: SlotNames): ModelChoice[] {
  const models = modelsFor(blockKey).map((m) => {
    const slot = userIrSlot(m.code);
    const file = slot === null ? null : slots.irNames?.[slot];
    const basedOn = modelInfo(blockKey, m.name)?.basedOn;
    return { name: file ? `${file} (${m.name})` : m.name, code: m.code, clone: false, ...(basedOn ? { basedOn } : {}) };
  });
  if (blockKey !== 'amp') return models;
  const profiles = modelsFor('clone').flatMap((m, i) => {
    const name = slots.profileNames?.[i];
    return name ? [{ name: `${name} (profile ${i + 1})`, code: m.code, clone: true }] : [];
  });
  return [...models, ...profiles];
}

/** A model for a block by name: catalog name, user IR file name, or captured profile name. */
export function resolveModel(blockKey: string, input: string, slots: SlotNames): ModelChoice {
  const label = blockKey.toUpperCase();
  const choices = modelChoices(blockKey, slots).map((c) => ({ names: aliases(c.name), value: c, label: c.name, also: c.basedOn }));
  return pick(`${label} model`, input, choices);
}

/** "Mesa OS (User IR 1)" answers to the whole name, "Mesa OS" and "User IR 1". */
function aliases(name: string): string[] {
  const match = /^(.*) \((.*)\)$/.exec(name);
  return match ? [name, match[1]!, match[2]!] : [name];
}

/** "P09" → 8, "F01" → 50. */
export function parsePresetLabel(input: string): number {
  const match = /^\s*([pf])\s*0*(\d{1,2})\s*$/i.exec(input);
  const n = match ? Number(match[2]) : 0;
  if (!match || n < 1 || n > USER_PRESETS) throw new Error(`"${input}" is not a preset; use P01..P50 or F01..F50`);
  return match[1]!.toLowerCase() === 'p' ? n - 1 : USER_PRESETS + n - 1;
}
