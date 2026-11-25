/**
 * What the Matribox II Pro model menus list: the block types (modules) a block can be, and one
 * module's models grouped by the `type` the person's own catalog gives them, in catalog order.
 * Nothing of the catalog is kept here; without it, modules go by index and models by raw id.
 */
import type { MbCatalog, MbModel } from '@pocket-master/core';
import { gearOf } from './matribox.ts';
import { MB_MODULE_KEYS, type MbModuleKey, mbFxidHex, mbLookKey, mbModelValue } from './matriboxLook.ts';

export interface MbMenuModule {
  readonly index: number;
  readonly name: string;
  readonly key: MbModuleKey;
}

export interface MbMenuOption {
  readonly value: string;
  readonly name: string;
  readonly detail?: string;
}

export interface MbMenuGroup {
  readonly name: string | null;
  readonly options: readonly MbMenuOption[];
}

interface ModelOptions {
  /** Heading of the models without a type, when the module's other models have one. */
  readonly other: string;
  /** A model the menu knows only by its id ("0x0300002a"). */
  readonly unknown: (hex: string) => string;
  /** The user IR or capture a model of this module plays (IR and CLONE), by fxid. */
  readonly userName?: (fxid: number) => string | undefined;
}

/** The block types, in catalog order; without the catalog every module the unit has, by index. */
export function mbMenuModules(catalog: MbCatalog | null): MbMenuModule[] {
  if (!catalog) return MB_MODULE_KEYS.map((key, index) => ({ index, name: key.toUpperCase(), key }));
  return catalog.modules.map((m) => ({ index: m.index, name: m.name, key: mbLookKey({ module: m.name, moduleIndex: m.index }) }));
}

function option(moduleIndex: number, model: MbModel, userName: ModelOptions['userName']): MbMenuOption {
  const user = userName?.(model.fxid);
  const detail = user ? model.name : gearOf(model);
  return { value: mbModelValue(moduleIndex, model.fxid), name: user ?? model.name, ...(detail ? { detail } : {}) };
}

/**
 * One module's models, grouped by type in the order the types first appear; no heading when the
 * module has a single type. Without the catalog, the models the chain already uses (`present`), by id.
 */
export function mbMenuModels(catalog: MbCatalog | null, moduleIndex: number, present: readonly number[], opts: ModelOptions): MbMenuGroup[] {
  if (!catalog) {
    const ids = [...new Set(present)];
    return ids.length === 0 ? [] : [{ name: null, options: ids.map((fxid) => ({ value: mbModelValue(moduleIndex, fxid), name: opts.unknown(mbFxidHex(fxid)) })) }];
  }
  const models = catalog.modules.find((m) => m.index === moduleIndex)?.models ?? [];
  const types = [...new Set(models.map((m) => m.type))];
  return types.map((type) => ({
    name: types.length === 1 ? null : type || opts.other,
    options: models.filter((m) => m.type === type).map((m) => option(moduleIndex, m, opts.userName)),
  }));
}
