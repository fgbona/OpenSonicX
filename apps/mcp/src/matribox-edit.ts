/**
 * Pure helpers behind the Matribox II Pro write tools: find a block, model or parameter by the names
 * the read tools show, check values against the catalog's ranges, and plan a whole tone as a chain
 * plus parameter writes. Nothing here talks to the unit.
 */
import { MB_SLOTS, type MbCatalog, type MbModel, type MbModule, type MbParam, type MbResolvedBlock, type MbResolvedPreset } from '@pocket-master/core';

export const EXPERIMENTAL =
  'Experimental: Matribox writes are validated on one unit only so far. Check the result with matribox_get_preset and by ear on the unit.';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const round = (n: number) => String(Number(n.toFixed(2)));
/** The real gear a model is based on, on one line; '' when the catalog gives none or only a number. */
export const gear = (model: MbModel) => (/[a-z]/i.test(model.origin) ? model.origin.replace(/\s+/g, ' ').trim() : '');
export const modelTitle = (model: MbModel) => `${model.name}${gear(model) ? ` (based on ${gear(model)})` : ''}`;

/** A block of the loaded preset by its 1-based chain position ("2") or its module name ("DRV", if only one). */
export function findBlock(preset: MbResolvedPreset, block: string): MbResolvedBlock {
  const chain = preset.chain.map((b) => `${b.position} ${b.module}`).join(', ');
  const byPosition = /^\d+$/.test(block.trim()) ? preset.chain.find((b) => b.position === Number(block)) : undefined;
  const byModule = preset.chain.filter((b) => same(b.module, block));
  if (byModule.length > 1) throw new Error(`The chain has ${byModule.length} ${byModule[0]?.module} blocks: name one by position. Chain: ${chain}`);
  const found = byPosition ?? byModule[0];
  if (!found) throw new Error(`No block "${block}". Chain: ${chain}`);
  return found;
}

/** The block's model, which must be one the catalog knows to be edited by name. */
export function knownModel(block: MbResolvedBlock): MbModel {
  if (!block.model) throw new Error(`Block ${block.position} ${block.module} holds an unknown model (fxid 0x${block.fxid.toString(16).padStart(8, '0')}): its parameters cannot be named.`);
  return block.model;
}

/** A parameter of `model` by name, with `value` checked against its range. */
export function checkParam(model: MbModel, name: string, value: number): MbParam {
  const param = model.params.find((p) => same(p.name, name));
  if (!param) throw new Error(`${model.name} has no parameter "${name}". Parameters: ${model.params.map((p) => p.name).join(', ') || 'none'}`);
  if (!Number.isFinite(value) || value < param.min || value > param.max) throw new Error(`${param.name} must be ${round(param.min)}..${round(param.max)}, got ${value}`);
  return param;
}

export function findModule(catalog: MbCatalog, name: string): MbModule {
  const found = catalog.modules.find((m) => same(m.name, name));
  if (!found) throw new Error(`No module "${name}". Modules: ${catalog.modules.map((m) => m.name).join(', ')}`);
  return found;
}

/** A model by name, in `module` when given, else anywhere in the catalog. */
export function findModel(catalog: MbCatalog, name: string, module?: MbModule): { module: MbModule; model: MbModel } {
  const found = (module ? [module] : catalog.modules).flatMap((m) => m.models.filter((model) => same(model.name, name)).map((model) => ({ module: m, model })));
  if (found.length === 0) throw new Error(module ? `No ${module.name} model "${name}". Models: ${module.models.map((m) => m.name).join(', ')}` : `No model "${name}": pick one from matribox_list_models.`);
  if (found.length > 1) throw new Error(`"${name}" is a model of ${found.map((f) => f.module.name).join(' and ')}: name the module too.`);
  return found[0] as { module: MbModule; model: MbModel };
}

export interface ParamWrite {
  readonly slot: number;
  readonly id: number;
  readonly value: number;
}

/** Every parameter of `model` in `slot`: the given values (checked), the catalog default for the rest. */
export function modelValues(model: MbModel, slot: number, given: Readonly<Record<string, number>> = {}): readonly ParamWrite[] {
  const values = new Map(Object.entries(given).map(([name, value]) => [checkParam(model, name, value).id, value]));
  return model.params.map((p) => ({ slot, id: p.id, value: values.get(p.id) ?? p.defaultValue }));
}

/** "Gain 70, Tone 0" for a model's parameter writes. */
export function describeValues(model: MbModel, writes: readonly ParamWrite[]): string {
  return model.params.map((p) => `${p.name} ${round(writes.find((w) => w.id === p.id)?.value ?? p.defaultValue)}`).join(', ');
}

export interface ToneBlock {
  readonly module: string;
  readonly model: string;
  readonly on?: boolean;
  readonly params?: Readonly<Record<string, number>>;
}

export interface PlannedBlock {
  readonly moduleIndex: number;
  readonly fxid: number;
  readonly on: boolean;
  readonly model: MbModel;
  /** The values asked for, by parameter name (checked); the rest take the model's default. */
  readonly params: Readonly<Record<string, number>>;
}

export interface TonePlan {
  /** Signal order. The unit picks each block's storage slot when it is added. */
  readonly blocks: readonly PlannedBlock[];
  readonly lines: readonly string[];
}

/** A whole tone in signal order, checked against the catalog before anything is sent. */
export function planTone(catalog: MbCatalog, blocks: readonly ToneBlock[]): TonePlan {
  if (blocks.length < 1 || blocks.length > MB_SLOTS) throw new Error(`A Matribox chain holds at least 1 and at most ${MB_SLOTS} blocks, got ${blocks.length}`);
  const planned = blocks.map((block, i) => {
    const { module, model } = findModel(catalog, block.model, findModule(catalog, block.module));
    const values = modelValues(model, 0, block.params); // checks the values; the slot is not known yet
    const on = block.on ?? true;
    const line = `${i + 1}. ${module.name} ${on ? 'on ' : 'off'} ${modelTitle(model)}${values.length ? `: ${describeValues(model, values)}` : ''}`;
    return { block: { moduleIndex: module.index, fxid: model.fxid, on, model, params: block.params ?? {} }, module, line };
  });
  return {
    blocks: planned.map((p) => p.block),
    lines: [`Chain: ${planned.map((p) => p.module.name).join(' → ')}`, ...planned.map((p) => p.line)],
  };
}
