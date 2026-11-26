/**
 * The tone assistant's live controls on the Matribox II Pro: footswitches, CTRL 1-4, quick knobs and
 * the expression pedal, named the way the model writes them and turned into core's checked writes.
 * Nothing here talks to the unit.
 */
import {
  MB_FS_FUNCTIONS,
  MB_QK_BPM,
  MB_QK_VOLUME,
  mbAssignCtrl,
  mbAssignments,
  mbAssignmentsText,
  mbAssignQuickKnob,
  mbExpressionWrites,
  mbFindParam,
  mbFootswitchToggleWrites,
  mbFsFunctionId,
  mbSetFootswitchFunction,
  type MbBlock,
  type MbCatalog,
  type MbPreset,
} from '@pocket-master/core';
import { findBlock, knownModel, moduleName, modelOf } from './matriboxPlan.ts';

export type ControlChange =
  | { kind: 'footswitch'; footswitch: string; block: string; toggles?: boolean }
  | { kind: 'footswitch_function'; footswitch: string; function: string; hold?: boolean }
  | { kind: 'ctrl'; ctrl: number; block: string; member?: boolean }
  | { kind: 'expression'; entry: number; block: string; parameter: string; min?: number; max?: number }
  | { kind: 'quick_knob'; knob: number; target: string; parameter?: string };

const LETTERS = 'ABCD';
const QK_TARGETS: Readonly<Record<string, number | null>> = { none: null, bpm: MB_QK_BPM, tempo: MB_QK_BPM, volume: MB_QK_VOLUME };

function footswitchIndex(name: unknown): number {
  const ref = String(name ?? '')
    .trim()
    .toUpperCase();
  const index = ref.length === 1 ? LETTERS.indexOf(ref) : -1;
  if (index < 0) throw new Error(`footswitch must be A, B, C or D, got "${String(name)}"`);
  return index;
}

function inRange(what: string, n: unknown, min: number, max: number): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be ${min}..${max}, got ${String(n)}`);
  return n;
}

/** The block and its parameter, by the names the model gives. */
function blockParam(catalog: MbCatalog, chain: readonly MbBlock[], block: string, parameter: unknown): { slot: number; paramId: number } {
  const at = findBlock(catalog, chain, block);
  const b = chain[at] as MbBlock;
  const model = knownModel(catalog, b, at);
  if (typeof parameter !== 'string' || !parameter.trim()) throw new Error(`name the parameter of block ${at + 1}: ${model.params.map((p) => p.name).join(', ')}`);
  return { slot: b.slot, paramId: mbFindParam(model, parameter).id };
}

const slotOf = (catalog: MbCatalog, chain: readonly MbBlock[], block: string) => (chain[findBlock(catalog, chain, block)] as MbBlock).slot;

/** The writes of one change on `preset` (as the unit has it now); throws on a bad name or value. */
export function controlWrites(catalog: MbCatalog, preset: MbPreset, c: ControlChange): Uint8Array[] {
  const chain = preset.chain;
  switch (c?.kind) {
    case 'footswitch':
      return mbFootswitchToggleWrites(mbAssignments(preset), footswitchIndex(c.footswitch), slotOf(catalog, chain, c.block), c.toggles ?? true);
    case 'footswitch_function':
      return [mbSetFootswitchFunction(footswitchIndex(c.footswitch), mbFsFunctionId(String(c.function ?? '')), Boolean(c.hold))];
    case 'ctrl':
      return [mbAssignCtrl(inRange('ctrl', c.ctrl, 1, 4) - 1, slotOf(catalog, chain, c.block), c.member ?? true)];
    case 'expression': {
      const entry = inRange('entry', c.entry, 1, 9) - 1;
      const { slot, paramId } = blockParam(catalog, chain, c.block, c.parameter);
      return mbExpressionWrites({ entry, slot, paramId, min: c.min ?? 0, max: c.max ?? 100 });
    }
    case 'quick_knob': {
      const knob = inRange('knob', c.knob, 1, 3) - 1;
      const key = String(c.target ?? '')
        .trim()
        .toLowerCase();
      if (Object.hasOwn(QK_TARGETS, key)) return mbAssignQuickKnob(knob, QK_TARGETS[key] ?? null, 0);
      const { slot, paramId } = blockParam(catalog, chain, c.target, c.parameter);
      return mbAssignQuickKnob(knob, slot, paramId);
    }
    default:
      throw new Error('kind must be footswitch, footswitch_function, ctrl, expression or quick_knob');
  }
}

/** The loaded preset's footswitches, CTRL groups, quick knobs and expression entries, one a line. */
export function mbControlsText(preset: MbPreset, catalog: MbCatalog): string {
  const at = (slot: number) => preset.chain.findIndex((b) => b.slot === slot);
  const a = mbAssignments(preset);
  const lines = mbAssignmentsText(a, {
    block: (slot) => {
      const i = at(slot);
      return i < 0 ? `slot ${slot + 1} (empty)` : `${i + 1} ${moduleName(catalog, (preset.chain[i] as MbBlock).moduleIndex)}`;
    },
    param: (slot, id) => {
      const b = preset.chain[at(slot)];
      return (b && modelOf(catalog, b)?.params.find((p) => p.id === id)?.name) ?? `parameter ${id}`;
    },
  });
  return [
    `Patch volume ${a.volume}, tempo ${a.tempo} BPM`,
    ...lines,
    'Footswitch functions are the stomp-mode ones. Expression entries 1-3 are EXP 1 mode A, 4-6 EXP 1 mode B (after the toe switch), 7-9 EXP 2.',
  ].join('\n');
}

export const MB_FS_FUNCTION_NAMES = MB_FS_FUNCTIONS.map((f) => f.name);
