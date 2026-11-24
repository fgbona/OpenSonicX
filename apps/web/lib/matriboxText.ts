/**
 * The Matribox II Pro as text for the tone assistant (the catalog, a module's models, the loaded
 * preset) and what an answer changed, in the rows the Pocket Master's "What changed" uses. The
 * catalog is the person's own alg_data.json: it goes to their AI provider, never anywhere else.
 */
import type { Difference, MbCatalog, MbModel, MbParam, MbPreset } from '@pocket-master/core';
import { gearOf } from './matribox.ts';
import { modelOf, moduleName, type MbChainBlock } from './matriboxPlan.ts';

const round = (n: number) => String(Number(n.toFixed(2)));
const isPercent = (p: MbParam) => p.min === 0 && p.max === 100;
const withGear = (model: MbModel, based = '') => `${model.name}${gearOf(model) ? ` (${based}${gearOf(model)})` : ''}`;
const fxidHex = (fxid: number) => `0x${fxid.toString(16).padStart(8, '0')}`;

/**
 * Every module's models with the gear each is based on, one line a module. `withParams` adds the
 * parameter names (ranges other than 0..100): too long for a free plan's tokens a minute.
 */
export function mbCatalogText(catalog: MbCatalog, withParams: boolean): string {
  const params = (m: MbModel) => ` [${m.params.map((p) => (isPercent(p) ? p.name : `${p.name} ${round(p.min)}..${round(p.max)}`)).join(', ')}]`;
  const lines = catalog.modules.map((mod) => `${mod.name}: ${mod.models.map((m) => `${withGear(m)}${withParams && m.params.length ? params(m) : ''}`).join('; ')}`);
  return `${lines.join('\n')}${withParams ? '\n(Parameters are 0..100 unless a range is given.)' : ''}`;
}

/** The models of the modules asked for (all when none), with every parameter's range and default. */
export function mbModelsText(catalog: MbCatalog, modules?: readonly string[]): string {
  const find = (name: string) => {
    const found = catalog.modules.find((m) => m.name.toLowerCase() === String(name).trim().toLowerCase());
    if (!found) throw new Error(`No module "${name}". Modules: ${catalog.modules.map((m) => m.name).join(', ')}`);
    return found;
  };
  const picked = modules?.length ? modules.map(find) : catalog.modules;
  const param = (p: MbParam) => `${p.name} ${round(p.min)}..${round(p.max)} (default ${round(p.defaultValue)})`;
  return picked.map((mod) => [mod.name, ...mod.models.map((m) => `- ${withGear(m, 'based on ')}: ${m.params.map(param).join(', ') || 'no parameters'}`)].join('\n')).join('\n\n');
}

function blockLine(catalog: MbCatalog, b: MbChainBlock, i: number): string {
  const model = modelOf(catalog, b);
  const head = `${i + 1}. ${moduleName(catalog, b.moduleIndex)} ${b.on ? 'on' : 'off'}`;
  if (!model) return `${head} unknown model ${fxidHex(b.fxid)}`;
  const values = model.params.map((p) => `${p.name} ${round(b.values[p.id] ?? Number.NaN)} (${round(p.min)}..${round(p.max)})`).join(', ');
  return `${head} ${withGear(model, 'based on ')}${values ? `: ${values}` : ''}`;
}

/** The loaded preset: name, chain in signal order, each block with its model, gear, on/off and values. */
export function mbPresetText(preset: Pick<MbPreset, 'name' | 'chain'>, catalog: MbCatalog): string {
  const chain = preset.chain.map((b) => moduleName(catalog, b.moduleIndex)).join(' → ') || 'empty';
  return [`Name: ${preset.name}`, `Chain: ${chain}`, ...preset.chain.map((b, i) => blockLine(catalog, b, i))].join('\n');
}

/**
 * What changed from `before` to `after`: the chain order, then each block of `after` (matched to
 * the first unused block of its module): a new model with the values it now has, else its values
 * and its switch. Parameter rows name the model and say when the block is off.
 */
export function mbChanges(before: Pick<MbPreset, 'chain'>, after: Pick<MbPreset, 'chain'>, catalog: MbCatalog, off = 'off'): Difference[] {
  const order = (p: Pick<MbPreset, 'chain'>) => p.chain.map((b) => moduleName(catalog, b.moduleIndex)).join(' ');
  const out: Difference[] = order(before) === order(after) ? [] : [{ what: 'order', from: order(before), to: order(after) }];
  const unused = [...before.chain];
  for (const b of after.chain) {
    const at = unused.findIndex((x) => x.moduleIndex === b.moduleIndex);
    const a = at >= 0 ? unused.splice(at, 1)[0]! : null;
    const block = moduleName(catalog, b.moduleIndex);
    const model = modelOf(catalog, b);
    const title = `${block} · ${model?.name ?? fxidHex(b.fxid)}${b.on ? '' : ` (${off})`}`;
    const newModel = !a || a.fxid !== b.fxid;
    if (newModel) out.push({ block, what: 'model', from: a ? (modelOf(catalog, a)?.name ?? fxidHex(a.fxid)) : '–', to: model?.name ?? fxidHex(b.fxid) });
    for (const p of model?.params ?? []) {
      const to = round(b.values[p.id] ?? Number.NaN);
      const from = newModel ? '–' : round(a!.values[p.id] ?? Number.NaN);
      if (newModel || from !== to) out.push({ block: title, what: 'param', name: p.name, from, to });
    }
    if (a && !newModel && a.on !== b.on) out.push({ block, what: 'on', from: a.on ? 'on' : 'off', to: b.on ? 'on' : 'off' });
  }
  return out;
}
