/**
 * Changes named the way a musician says them ("AMP gain 70", "DRV model Butter OD"), turned into
 * edits with the same checks and errors for every surface: the MCP server and the editor's chat.
 */
import type { ParamSpec } from '../catalog.ts';
import { chainUnits, moveInChain } from '../chain.ts';
import { encodeValue } from '../commands.ts';
import type { Preset } from '../dump.ts';
import type { Edit } from '../edit.ts';
import { resolveBlock, resolveModel, resolveParam, type SlotNames } from '../resolve.ts';

/** A change named the way a musician says it. */
export type Change =
  | { readonly kind: 'parameter'; readonly block: string; readonly parameter: string; readonly value: number | boolean | string }
  | { readonly kind: 'block'; readonly block: string; readonly on: boolean }
  | { readonly kind: 'model'; readonly block: string; readonly model: string }
  | { readonly kind: 'move'; readonly block: string; readonly position: number }
  | { readonly kind: 'volume'; readonly value: number };

/** The value as the parameter's type expects it; refuses anything that would have to be guessed. */
function typedValue(spec: ParamSpec, value: number | boolean | string): number | boolean | string {
  const text = typeof value === 'string' ? value.trim() : null;
  if (spec.type === 'switch') {
    if (typeof value === 'boolean') return value;
    if (text?.toLowerCase() === 'on' || text?.toLowerCase() === 'off') return text.toLowerCase() === 'on';
    throw new Error(`${spec.name} is a switch: use true/false or "on"/"off"`);
  }
  if (spec.type === 'select') {
    const options = spec.options ?? [];
    const index = text === null ? (typeof value === 'number' ? value : -1) : options.findIndex((o) => o.toLowerCase() === text.toLowerCase());
    if (index < 0) throw new Error(`${spec.name} options: ${options.join(', ')}`);
    return index;
  }
  if (typeof value === 'number') return value;
  if (text && Number.isFinite(Number(text))) return Number(text);
  throw new Error(`${spec.name} needs a number`);
}

export function toEdit(preset: Preset, change: Change, slots: SlotNames): Edit {
  if (change.kind === 'volume') return { kind: 'volume', value: change.value };
  const block = resolveBlock(preset, change.block);
  switch (change.kind) {
    case 'parameter': {
      const spec = resolveParam(preset, block, change.parameter);
      return { kind: 'param', module: block.module, alg: spec.alg, value: encodeValue(spec, typedValue(spec, change.value)) };
    }
    case 'block':
      return { kind: 'on', module: block.module, on: change.on };
    case 'model': {
      const model = resolveModel(block.key, change.model, slots);
      return { kind: 'model', module: block.module, code: model.code, clone: model.clone };
    }
    case 'move': {
      const order = preset.chain.map((b) => b.module);
      const units = chainUnits(order).length;
      if (!Number.isInteger(change.position) || change.position < 1 || change.position > units) {
        throw new Error(`position must be 1..${units} (DRV, AMP, IR and EQ move together)`);
      }
      return { kind: 'chain', order: moveInChain(order, block.module, change.position - 1) };
    }
  }
}
