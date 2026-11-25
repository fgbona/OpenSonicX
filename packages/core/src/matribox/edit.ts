/**
 * Catalog checks behind every Matribox II Pro edit, shared by the MCP server and the web editor:
 * find a module, model or parameter by the name the catalog shows (case and outer spaces ignored)
 * and check a value against its range. Pure: nothing here talks to the unit.
 */
import type { MbCatalog, MbModel, MbModule, MbParam } from './catalog.ts';
import { MB_SLOTS } from './write.ts';

/** Names match whatever their case and outer spaces. */
export const mbSameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const round = (n: number) => String(Number(n.toFixed(2)));

export function mbFindModule(catalog: MbCatalog, name: string): MbModule {
  const found = catalog.modules.find((m) => mbSameName(m.name, name));
  if (!found) throw new Error(`No module "${name}". Modules: ${catalog.modules.map((m) => m.name).join(', ')}`);
  return found;
}

/** A model of `module` by name. */
export function mbFindModel(module: MbModule, name: string): MbModel {
  const found = module.models.find((m) => mbSameName(m.name, name));
  if (!found) throw new Error(`No ${module.name} model "${name}". Models: ${module.models.map((m) => m.name).join(', ')}`);
  return found;
}

/** A parameter of `model` by name. */
export function mbFindParam(model: MbModel, name: string): MbParam {
  const param = model.params.find((p) => mbSameName(p.name, name));
  if (!param) throw new Error(`${model.name} has no parameter "${name}". Parameters: ${model.params.map((p) => p.name).join(', ') || 'none'}`);
  return param;
}

/** A parameter of `model` by name, with `value` checked against its range (anything but a finite number is refused). */
export function mbCheckParam(model: MbModel, name: string, value: number): MbParam {
  const param = mbFindParam(model, name);
  if (!Number.isFinite(value) || value < param.min || value > param.max) throw new Error(`${param.name} must be ${round(param.min)}..${round(param.max)}, got ${value}`);
  return param;
}

/** A chain holds 1..MB_SLOTS blocks. */
export function mbCheckChainLength(length: number): void {
  if (length < 1 || length > MB_SLOTS) throw new Error(`A Matribox chain holds at least 1 and at most ${MB_SLOTS} blocks, got ${length}`);
}
