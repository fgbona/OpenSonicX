import catalogJson from './catalog.json' with { type: 'json' };

export interface ParamSpec {
  readonly name: string;
  /** Parameter slot inside the module (0..7). */
  readonly alg: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly default?: number;
  readonly unit?: string;
  readonly type?: 'switch' | 'select';
  readonly options?: readonly string[];
}

export interface ModelSpec {
  readonly id: number;
  readonly name: string;
  /** Effect code: category << 24 | id. */
  readonly code: number;
  readonly params: readonly ParamSpec[];
}

export interface BlockSpec {
  readonly key: string;
  readonly module: number;
  readonly label: string;
}

interface Catalog {
  readonly blocks: readonly BlockSpec[];
  readonly models: Readonly<Record<string, readonly ModelSpec[]>>;
}

export const catalog = catalogJson as Catalog;

/** Module 9 holds captured-amp ("clone") profiles; it replaces AMP when amp mode is clone. */
export const CLONE_MODULE = 9;
const CLONE_KEY = 'clone';
const LOW_24_BITS = 0xffffff;

export function blockByModule(module: number): BlockSpec | undefined {
  return catalog.blocks.find((b) => b.module === module);
}

export function modelsFor(key: string): readonly ModelSpec[] {
  return catalog.models[key] ?? [];
}

/** Model for an effect code. Blocks with a single model (the NR gate) match any code. */
export function findModel(key: string, code: number): ModelSpec | undefined {
  const models = modelsFor(key);
  if (models.length === 1) return models[0];
  return models.find((m) => m.code === code);
}

/** Captured profiles report category 0x0F but are catalogued as 0x07, so only the low 24 bits are compared. */
export function findCloneModel(code: number): ModelSpec | undefined {
  return modelsFor(CLONE_KEY).find((m) => (m.code & LOW_24_BITS) === (code & LOW_24_BITS));
}
