/**
 * Runs chain-position writes (matriboxPlan.ts) on the unit with the core builders, the ones checked
 * on hardware: set param, on/off, change model, add, move, remove. Set param, on/off and change
 * model name a storage slot, so the loaded preset is read again after every chain edit.
 *
 * applyChain is how a whole chain is sent (Undo, Redo, the assistant): it plans from what the unit
 * holds, never from what the screen shows, and on a failed write puts the unit back as it was. A
 * write the unit applied but did not confirm (the owner's 3 s timeouts) otherwise stayed, and a
 * retried build planned from the stale screen added the whole chain again (12 blocks, 2026-11-26).
 */
import { mbAddBlock, mbChangeModel, mbMoveBlock, mbRemoveBlock, mbSetBlockOn, mbSetParam, type MatriboxLink, type MbCatalog, type MbPreset } from '@pocket-master/core';
import { readLoaded, withBlockOn, withParam } from './matribox.ts';
import { modelOf, moduleName, transition, type MbChainBlock, type MbOp } from './matriboxPlan.ts';

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ChainOp = Exclude<MbOp, { kind: 'param' | 'on' }>;

function chainFrame(op: ChainOp, slotAt: (position: number) => number): Uint8Array {
  switch (op.kind) {
    case 'model':
      return mbChangeModel(slotAt(op.position), op.moduleIndex, op.fxid);
    case 'add':
      return mbAddBlock(op.position, op.moduleIndex, op.fxid);
    case 'remove':
      return mbRemoveBlock(op.position);
    case 'move':
      return mbMoveBlock(op.from, op.to);
  }
}

/** A block as an error names it: "CAB Marshall 4x12" (the module alone when the catalog does not know the model). */
function blockName(catalog: MbCatalog, b: Pick<MbChainBlock, 'moduleIndex' | 'fxid'>): string {
  const model = modelOf(catalog, b);
  return model ? `${moduleName(catalog, b.moduleIndex)} ${model.name}` : moduleName(catalog, b.moduleIndex);
}

const round = (n: number) => String(Number(n.toFixed(2)));

/**
 * The write `op` in human terms, for an error: "Block 3 (CAB Marshall 4x12), Low Cut = 80". English,
 * the shape i18n.ts translates (WRITE_PATTERN there).
 */
function describeOp(catalog: MbCatalog, preset: MbPreset, op: MbOp): string {
  const at = op.kind === 'move' ? op.from : op.position;
  const held = preset.chain[at];
  const name = op.kind === 'add' || op.kind === 'model' ? blockName(catalog, op) : held ? blockName(catalog, held) : '?';
  const change =
    op.kind === 'param'
      ? `${(held && modelOf(catalog, held)?.params.find((p) => p.id === op.id)?.name) ?? `parameter ${op.id}`} = ${round(op.value)}`
      : op.kind === 'on'
        ? op.on
          ? 'on'
          : 'off'
        : op.kind === 'move'
          ? `move to ${op.to + 1}`
          : op.kind === 'model'
            ? 'model change'
            : op.kind;
  return `Block ${at + 1} (${name}), ${change}`;
}

/** Writes `ops` in order and returns the loaded preset as the unit has it afterwards. A value or switch the unit already has is not sent. */
export async function applyOps(unit: MatriboxLink, catalog: MbCatalog, ops: readonly MbOp[], read?: MbPreset): Promise<MbPreset> {
  let preset = read ?? (await readLoaded(unit)).preset;
  const slotAt = (position: number) => {
    const slot = preset.chain[position]?.slot;
    if (slot === undefined) throw new Error(`Matribox: no block at position ${position + 1} (the chain has ${preset.chain.length})`);
    return slot;
  };
  const send = async (op: MbOp, frame: () => Uint8Array) => {
    try {
      await unit.write(frame());
    } catch (error) {
      throw new Error(`${describeOp(catalog, preset, op)}: ${reasonOf(error)}`);
    }
  };
  for (const op of ops) {
    if (op.kind === 'param') {
      const slot = slotAt(op.position);
      const block = preset.chain[op.position]!;
      if (block.values[op.id] === op.value) continue;
      // The unit takes a parameter's order in its model's list, not its widget ID (core mbSetParam).
      await send(op, () => mbSetParam(slot, modelOf(catalog, block), op.id, op.value));
      preset = withParam(preset, slot, op.id, op.value);
    } else if (op.kind === 'on') {
      const slot = slotAt(op.position);
      if (preset.chain[op.position]!.on === op.on) continue;
      await send(op, () => mbSetBlockOn(slot, op.on));
      preset = withBlockOn(preset, slot, op.on);
    } else {
      await send(op, () => chainFrame(op, slotAt));
      preset = (await readLoaded(unit)).preset;
    }
  }
  // What the unit holds, not what was meant: the screen shows the unit's values.
  return ops.length > 0 ? (await readLoaded(unit)).preset : preset;
}

/** A chain the unit did not take; `preset` is what it holds now (read again), null when it could not be read. */
export class MbApplyError extends Error {
  readonly preset: MbPreset | null;
  constructor(message: string, preset: MbPreset | null) {
    super(message);
    this.preset = preset;
  }
}

/**
 * Turns the loaded preset's chain into `target`, planned from the unit's own state. When a write
 * fails the unit is put back to the chain it had (planned again from what it holds then) and the
 * error says whether that worked; it carries the preset as the unit has it afterwards.
 */
export async function applyChain(unit: MatriboxLink, catalog: MbCatalog, target: readonly MbChainBlock[]): Promise<MbPreset> {
  const before = (await readLoaded(unit)).preset;
  try {
    return await applyOps(unit, catalog, transition(catalog, before.chain, target), before);
  } catch (error) {
    let now: MbPreset | null = null;
    try {
      now = (await readLoaded(unit)).preset;
      now = await applyOps(unit, catalog, transition(catalog, now.chain, before.chain), now);
    } catch (rollback) {
      console.error('Matribox: could not put the chain back', rollback);
      const held =
        now ??
        (await readLoaded(unit)
          .then((l) => l.preset)
          .catch(() => null));
      throw new MbApplyError(`${reasonOf(error)} The change stopped part way and could not be undone (${reasonOf(rollback)}): the screen shows what the Matribox holds now.`, held);
    }
    throw new MbApplyError(`${reasonOf(error)} Nothing was applied: the Matribox is back as it was.`, now);
  }
}
