/**
 * How a Matribox II Pro block looks in the editor: its module's tint and drawing, the faceplate
 * finish of an AMP model, and which control a parameter gets, from the catalog (module names, a
 * model's `basedOn`, a parameter's range).
 */
import type { MbParam } from '@pocket-master/core';
import type { AmpSkin } from './ampSkins.ts';

/** The modules of the unit, in catalog order; each has a tint (app/matribox.css) and a drawing (ModuleIcon). */
export const MB_MODULE_KEYS = ['dyn', 'freq', 'wah', 'drv', 'amp', 'cab', 'ir', 'eq', 'mod', 'dly', 'rvb', 'clone', 'fxloop', 'fxsnd', 'fxrtn', 'vol'] as const;
export type MbModuleKey = (typeof MB_MODULE_KEYS)[number] | 'other';

/** The look key of a module name ("DRV" → "drv"); "other" without a catalog or for a module not known here. */
export function mbModuleKey(moduleName: string): MbModuleKey {
  const key = moduleName.toLowerCase().replace(/[^a-z]/g, '');
  return (MB_MODULE_KEYS as readonly string[]).includes(key) ? (key as MbModuleKey) : 'other';
}

/** A block's look key: by its module's name, else by its catalog index (DYN 0 … VOL 15), so a chain read without the catalog keeps its colours. */
export function mbLookKey(block: { readonly module: string; readonly moduleIndex: number }): MbModuleKey {
  const named = mbModuleKey(block.module);
  return named === 'other' ? (MB_MODULE_KEYS[block.moduleIndex] ?? 'other') : named;
}

/** A model id as the unit's protocol writes it, for a model the catalog does not name. */
export const mbFxidHex = (fxid: number) => `0x${fxid.toString(16).padStart(8, '0')}`;

/** A model menu's option value: the module and the model, as the unit's writes name them. */
export const mbModelValue = (moduleIndex: number, fxid: number) => `${moduleIndex}:${fxid}`;

export function parseMbModelValue(value: string): { moduleIndex: number; fxid: number } | null {
  const match = /^(\d+):(\d+)$/.exec(value);
  return match ? { moduleIndex: Number(match[1]), fxid: Number(match[2]) } : null;
}

/** Makers and model names as a `basedOn` text spells them; the first match wins (bass amps before a maker's guitar amps). */
const SKIN_RULES: readonly (readonly [RegExp, AmpSkin])[] = [
  [/roland|jazz chorus|jc-?120/i, 'jazz'],
  [/ampeg|svt|gallien|aguilar|darkglass|markbass|hartke|bass amp/i, 'bass'],
  [/tweed|bassman|champ/i, 'tweed'],
  [/fender|blackface|twin reverb|deluxe reverb|princeton/i, 'blackface'],
  [/marshall|plexi|jcm|jvm|jtm/i, 'marshall'],
  [/mesa|boogie|rectifier/i, 'mesa'],
  [/vox|ac-?30|ac-?15/i, 'vox'],
  [/soldano|slo-?100/i, 'hotrod'],
  [/peavey|5150|6505|evh/i, 'metal'],
  [/engl|diezel|hughes|framus/i, 'german'],
  [/bogner|friedman|matchless|dumble|two[- ]?rock|suhr|fortin|dr\.? ?z\b/i, 'boutique'],
];

/** The faceplate finish for an AMP model's `basedOn` (materials and colours, never a logo); null keeps the plain plate. */
export function mbAmpSkin(basedOn: string): AmpSkin | null {
  return SKIN_RULES.find(([pattern]) => pattern.test(basedOn))?.[1] ?? null;
}

type Range = Pick<MbParam, 'min' | 'max' | 'step'>;
/** Most steps a small selector lists (0..7). */
const SELECT_STEPS = 7;

const stepCount = (p: Range) => (p.step > 0 ? (p.max - p.min) / p.step : Number.NaN);

/** A 0..1 parameter is a switch, one with a few whole steps a small selector, anything else a knob. */
export function mbControl(p: Range): 'switch' | 'select' | 'knob' {
  const steps = stepCount(p);
  if (!Number.isInteger(steps) || steps < 1 || steps > SELECT_STEPS) return 'knob';
  return steps === 1 && p.min === 0 ? 'switch' : 'select';
}

/** The values a small selector offers: min, min + step, … max. */
export function mbSteps(p: Range): number[] {
  return Array.from({ length: Math.round(stepCount(p)) + 1 }, (_, i) => Number((p.min + i * p.step).toFixed(6)));
}
