/**
 * Matribox II Pro chains as plain data: a tone or small edits checked against the catalog (names
 * as the assistant writes them), and the unit's validated writes that turn one chain into another
 * (Undo, Redo and the assistant all go through `transition`). Nothing here talks to the unit.
 * The checks follow the MCP server's (apps/mcp/src/matribox-edit.ts).
 */
import { MB_SLOTS, type MbBlock, type MbCatalog, type MbModel, type MbModule, type MbParam } from '@pocket-master/core';

/** A block as a chain edit sees it: no storage slot (the unit picks it), the 15 values by widget ID. */
export type MbChainBlock = Omit<MbBlock, 'slot'>;

/** One write, by 0-based chain position; the executor finds the slot (matriboxOps.ts). */
export type MbOp =
  | { readonly kind: 'param'; readonly position: number; readonly id: number; readonly value: number }
  | { readonly kind: 'on'; readonly position: number; readonly on: boolean }
  | { readonly kind: 'model' | 'add'; readonly position: number; readonly moduleIndex: number; readonly fxid: number }
  | { readonly kind: 'remove'; readonly position: number }
  | { readonly kind: 'move'; readonly from: number; readonly to: number };

export interface ParamValue {
  readonly name: string;
  readonly value: number;
}

export interface ToneBlock {
  readonly module: string;
  readonly model: string;
  readonly on?: boolean;
  readonly params?: readonly ParamValue[];
}

export type ChainChange =
  | { readonly kind: 'parameter'; readonly block: string; readonly parameter: string; readonly value: number }
  | { readonly kind: 'block'; readonly block: string; readonly on: boolean }
  | { readonly kind: 'model'; readonly block: string; readonly model: string }
  | ({ readonly kind: 'add'; readonly position?: number } & ToneBlock)
  | { readonly kind: 'remove'; readonly block: string }
  | { readonly kind: 'move'; readonly block: string; readonly position: number };

const VALUES = 15;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const round = (n: number) => String(Number(n.toFixed(2)));

export const moduleName = (catalog: MbCatalog, index: number) => catalog.modules.find((m) => m.index === index)?.name ?? `module ${index}`;
export const modelOf = (catalog: MbCatalog, b: Pick<MbChainBlock, 'moduleIndex' | 'fxid'>): MbModel | null =>
  catalog.modules.find((m) => m.index === b.moduleIndex)?.models.find((m) => m.fxid === b.fxid) ?? null;

function findModule(catalog: MbCatalog, name: string): MbModule {
  const found = catalog.modules.find((m) => same(m.name, name));
  if (!found) throw new Error(`No module "${name}". Modules: ${catalog.modules.map((m) => m.name).join(', ')}`);
  return found;
}

function findModel(module: MbModule, name: string): MbModel {
  const found = module.models.find((m) => same(m.name, name));
  if (!found) throw new Error(`No ${module.name} model "${name}". Models: ${module.models.map((m) => m.name).join(', ')}`);
  return found;
}

function checkParam(model: MbModel, name: string, value: number): MbParam {
  const param = model.params.find((p) => same(p.name, name));
  if (!param) throw new Error(`${model.name} has no parameter "${name}". Parameters: ${model.params.map((p) => p.name).join(', ') || 'none'}`);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < param.min || value > param.max) throw new Error(`${param.name} must be ${round(param.min)}..${round(param.max)}, got ${value}`);
  return param;
}

/** A new block of `module`/`model`: the given values (checked), the model's defaults for the rest. */
function newBlock(catalog: MbCatalog, block: ToneBlock): MbChainBlock {
  const module = findModule(catalog, block.module);
  const model = findModel(module, block.model);
  const values = Array.from({ length: VALUES }, (_, id) => model.params.find((p) => p.id === id)?.defaultValue ?? 0);
  for (const p of block.params ?? []) values[checkParam(model, p.name, p.value).id] = p.value;
  return { moduleIndex: module.index, fxid: model.fxid, on: block.on ?? true, values };
}

function checkLength(length: number): void {
  if (length < 1 || length > MB_SLOTS) throw new Error(`A Matribox chain holds at least 1 and at most ${MB_SLOTS} blocks, got ${length}`);
}

/** A whole tone in signal order, checked against the catalog before anything is sent. */
export function planTone(catalog: MbCatalog, blocks: readonly ToneBlock[]): readonly MbChainBlock[] {
  checkLength(blocks.length);
  return blocks.map((b) => newBlock(catalog, b));
}

/** A block by its 1-based chain position ("2") or its module name ("DRV", when the chain has only one). */
function findBlock(catalog: MbCatalog, chain: readonly MbChainBlock[], block: string): number {
  const names = chain.map((b, i) => `${i + 1} ${moduleName(catalog, b.moduleIndex)}`).join(', ');
  const ref = String(block).trim();
  if (/^\d+$/.test(ref) && Number(ref) >= 1 && Number(ref) <= chain.length) return Number(ref) - 1;
  const byModule = chain.flatMap((b, i) => (same(moduleName(catalog, b.moduleIndex), ref) ? [i] : []));
  if (byModule.length > 1) throw new Error(`The chain has ${byModule.length} ${ref.toUpperCase()} blocks: name one by position. Chain: ${names}`);
  if (byModule.length === 0) throw new Error(`No block "${ref}". Chain: ${names}`);
  return byModule[0]!;
}

function knownModel(catalog: MbCatalog, b: MbChainBlock, position: number): MbModel {
  const model = modelOf(catalog, b);
  if (!model) throw new Error(`Block ${position + 1} holds an unknown model (fxid 0x${b.fxid.toString(16).padStart(8, '0')}): its parameters cannot be named.`);
  return model;
}

const replaced = <T>(list: readonly T[], at: number, item: T) => list.map((x, i) => (i === at ? item : x));
const moved = <T>(list: readonly T[], from: number, to: number) => {
  const rest = list.filter((_, i) => i !== from);
  return [...rest.slice(0, to), list[from]!, ...rest.slice(to)];
};

function applyChange(catalog: MbCatalog, chain: readonly MbChainBlock[], c: ChainChange): readonly MbChainBlock[] {
  switch (c.kind) {
    case 'parameter': {
      const at = findBlock(catalog, chain, c.block);
      const b = chain[at]!;
      const id = checkParam(knownModel(catalog, b, at), c.parameter, c.value).id;
      return replaced(chain, at, { ...b, values: replaced(b.values, id, c.value) });
    }
    case 'block': {
      const at = findBlock(catalog, chain, c.block);
      return replaced(chain, at, { ...chain[at]!, on: Boolean(c.on) });
    }
    case 'model': {
      const at = findBlock(catalog, chain, c.block);
      const b = chain[at]!;
      return replaced(chain, at, { ...newBlock(catalog, { module: moduleName(catalog, b.moduleIndex), model: c.model }), on: b.on });
    }
    case 'add': {
      if (chain.length >= MB_SLOTS) throw new Error(`The chain is full (${MB_SLOTS} blocks): remove one first.`);
      const at = c.position === undefined ? chain.length : Math.min(Math.max(Math.trunc(c.position) - 1, 0), chain.length);
      return [...chain.slice(0, at), newBlock(catalog, c), ...chain.slice(at)];
    }
    case 'remove': {
      if (chain.length <= 1) throw new Error('The chain needs at least one block.');
      const at = findBlock(catalog, chain, c.block);
      return chain.filter((_, i) => i !== at);
    }
    case 'move': {
      const at = findBlock(catalog, chain, c.block);
      if (!Number.isInteger(c.position) || c.position < 1 || c.position > chain.length) throw new Error(`position must be 1..${chain.length}, got ${c.position}`);
      return moved(chain, at, c.position - 1);
    }
    default:
      throw new Error('kind must be parameter, block, model, add, remove or move');
  }
}

/** Small edits applied in order (each names blocks as the chain is after the edits before it). */
export function editChain(catalog: MbCatalog, chain: readonly MbChainBlock[], changes: readonly ChainChange[]): readonly MbChainBlock[] {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('changes must be a non-empty list');
  return changes.reduce((acc, c) => applyChange(catalog, acc, c), chain);
}

const key = (b: Pick<MbChainBlock, 'moduleIndex' | 'fxid'>) => `${b.moduleIndex}:${b.fxid}`;

/** A block as a chain edit leaves it: the same block, or a fresh one (the unit loaded the model's defaults). */
interface Simulated {
  readonly key: string;
  readonly from: MbChainBlock | null;
}

type Structural = Exclude<MbOp, { kind: 'param' | 'on' }>;

function simulate(chain: readonly Simulated[], op: Structural): readonly Simulated[] {
  switch (op.kind) {
    case 'model': return replaced(chain, op.position, { key: key(op), from: null });
    case 'add': return [...chain.slice(0, op.position), { key: key(op), from: null }, ...chain.slice(op.position)];
    case 'remove': return chain.filter((_, i) => i !== op.position);
    case 'move': return moved(chain, op.from, op.to);
  }
}

/** The single chain edits that could lead from a chain of `n` blocks to `target`. */
function candidates(n: number, target: readonly MbChainBlock[]): Structural[] {
  const out: Structural[] = [];
  const positions = (count: number) => Array.from({ length: count }, (_, i) => i);
  if (target.length === n) {
    for (const i of positions(n)) out.push({ kind: 'model', position: i, moduleIndex: target[i]!.moduleIndex, fxid: target[i]!.fxid });
    for (const from of positions(n)) for (const to of positions(n)) if (from !== to) out.push({ kind: 'move', from, to });
  }
  if (target.length === n + 1) for (const i of positions(n + 1)) out.push({ kind: 'add', position: i, moduleIndex: target[i]!.moduleIndex, fxid: target[i]!.fxid });
  if (target.length === n - 1) for (const i of positions(n)) out.push({ kind: 'remove', position: i });
  return out;
}

/** The values and on/off to write once the chain has `target`'s blocks: all of them for a fresh block. */
function blockWrites(catalog: MbCatalog, sim: readonly Simulated[], target: readonly MbChainBlock[]): MbOp[] {
  return target.flatMap((to, position): MbOp[] => {
    const from = sim[position]?.from ?? null;
    // ponytail: a model the catalog does not know gets no value writes (its widget IDs are unknown).
    const ids = (modelOf(catalog, to)?.params ?? []).map((p) => p.id);
    const params = ids.filter((id) => !from || from.values[id] !== to.values[id]).map((id): MbOp => ({ kind: 'param', position, id, value: to.values[id]! }));
    return !from || from.on !== to.on ? [...params, { kind: 'on', position, on: to.on }] : params;
  });
}

/**
 * The writes that turn `current` into `target`: values and switches alone when the chain is the
 * same; one add, remove, move or model change when that is the difference; else the chain is
 * rebuilt from its first differing block (removed from the end, then added in order).
 */
export function transition(catalog: MbCatalog, current: readonly MbChainBlock[], target: readonly MbChainBlock[]): readonly MbOp[] {
  const start: readonly Simulated[] = current.map((b) => ({ key: key(b), from: b }));
  const wanted = target.map(key).join(' ');
  const matches = (sim: readonly Simulated[]) => sim.map((s) => s.key).join(' ') === wanted;
  if (matches(start)) return blockWrites(catalog, start, target);
  for (const op of candidates(current.length, target)) {
    const sim = simulate(start, op);
    if (matches(sim)) return [op, ...blockWrites(catalog, sim, target)];
  }
  let first = 0;
  while (first < current.length && first < target.length && start[first]!.key === key(target[first]!)) first++;
  const removes = current.slice(first).map((_, i): Structural => ({ kind: 'remove', position: current.length - 1 - i }));
  const adds = target.slice(first).map((b, i): Structural => ({ kind: 'add', position: first + i, moduleIndex: b.moduleIndex, fxid: b.fxid }));
  const sim = [...removes, ...adds].reduce(simulate, start);
  return [...removes, ...adds, ...blockWrites(catalog, sim, target)];
}
