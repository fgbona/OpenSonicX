/**
 * Runs chain-position writes (matriboxPlan.ts) on the unit with the core builders, the ones checked
 * on hardware: set param, on/off, change model, add, move, remove. Set param, on/off and change
 * model name a storage slot, so the loaded preset is read again after every chain edit.
 */
import { mbAddBlock, mbChangeModel, mbMoveBlock, mbRemoveBlock, mbSetBlockOn, mbSetParam, type MatriboxLink, type MbPreset } from '@pocket-master/core';
import { readLoaded, withBlockOn, withParam } from './matribox.ts';
import type { MbOp } from './matriboxPlan.ts';

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

/** Writes `ops` in order and returns the loaded preset as the unit has it afterwards. */
export async function applyOps(unit: MatriboxLink, ops: readonly MbOp[]): Promise<MbPreset> {
  let preset = (await readLoaded(unit)).preset;
  const slotAt = (position: number) => {
    const slot = preset.chain[position]?.slot;
    if (slot === undefined) throw new Error(`Matribox: no block at position ${position + 1} (the chain has ${preset.chain.length})`);
    return slot;
  };
  for (const op of ops) {
    if (op.kind === 'param') {
      const slot = slotAt(op.position);
      await unit.write(mbSetParam(slot, op.id, op.value));
      preset = withParam(preset, slot, op.id, op.value);
    } else if (op.kind === 'on') {
      const slot = slotAt(op.position);
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
