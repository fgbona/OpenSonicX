/**
 * What the Matribox II Pro model menus list: the block types (modules) a block can be, and one
 * module's models grouped by their `type`, in catalog order.
 */
import type { MbCatalog, MbModel } from '@pocket-master/core';
import { type MbModuleKey, mbLookKey, mbModelValue } from './matriboxLook.ts';

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
  /** The user IR or capture a model of this module plays (IR and CLONE), by fxid. */
  readonly userName?: (fxid: number) => string | undefined;
}

/** The block types, in catalog order. */
export function mbMenuModules(catalog: MbCatalog): MbMenuModule[] {
  return catalog.modules.map((m) => ({ index: m.index, name: m.name, key: mbLookKey({ module: m.name, moduleIndex: m.index }) }));
}

function option(moduleIndex: number, model: MbModel, userName: ModelOptions['userName']): MbMenuOption {
  const user = userName?.(model.fxid);
  const detail = user ? model.name : model.basedOn;
  return { value: mbModelValue(moduleIndex, model.fxid), name: user ?? model.name, ...(detail ? { detail } : {}) };
}

/**
 * One module's models, grouped by type in the order the types first appear; no heading when the
 * module has a single type.
 */
export function mbMenuModels(catalog: MbCatalog, moduleIndex: number, opts: ModelOptions): MbMenuGroup[] {
  const models = catalog.modules.find((m) => m.index === moduleIndex)?.models ?? [];
  const types = [...new Set(models.map((m) => m.type))];
  return types.map((type) => ({
    name: types.length === 1 ? null : type || opts.other,
    options: models.filter((m) => m.type === type).map((m) => option(moduleIndex, m, opts.userName)),
  }));
}
