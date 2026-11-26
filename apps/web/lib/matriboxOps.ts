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
import { transition, type MbChainBlock, type MbOp } from './matriboxPlan.ts';

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

/** Writes `ops` in order and returns the loaded preset as the unit has it afterwards. A value or switch the unit already has is not sent. */
export async function applyOps(unit: MatriboxLink, ops: readonly MbOp[], read?: MbPreset): Promise<MbPreset> {
  let preset = read ?? (await readLoaded(unit)).preset;
  const slotAt = (position: number) => {
    const slot = preset.chain[position]?.slot;
    if (slot === undefined) throw new Error(`Matribox: no block at position ${position + 1} (the chain has ${preset.chain.length})`);
    return slot;
  };
  for (const op of ops) {
    if (op.kind === 'param') {
      const slot = slotAt(op.position);
      if (preset.chain[op.position]!.values[op.id] === op.value) continue;
      await unit.write(mbSetParam(slot, op.id, op.value));
      preset = withParam(preset, slot, op.id, op.value);
    } else if (op.kind === 'on') {
      const slot = slotAt(op.position);
      if (preset.chain[op.position]!.on === op.on) continue;
      await unit.write(mbSetBlockOn(slot, op.on));
      preset = withBlockOn(preset, slot, op.on);
    } else {
      await unit.write(chainFrame(op, slotAt));
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

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Turns the loaded preset's chain into `target`, planned from the unit's own state. When a write
 * fails the unit is put back to the chain it had (planned again from what it holds then) and the
 * error says whether that worked; it carries the preset as the unit has it afterwards.
 */
export async function applyChain(unit: MatriboxLink, catalog: MbCatalog, target: readonly MbChainBlock[]): Promise<MbPreset> {
  const before = (await readLoaded(unit)).preset;
  try {
    return await applyOps(unit, transition(catalog, before.chain, target), before);
  } catch (error) {
    let now: MbPreset | null = null;
    try {
      now = (await readLoaded(unit)).preset;
      now = await applyOps(unit, transition(catalog, now.chain, before.chain), now);
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
