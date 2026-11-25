/**
 * The Matribox II Pro's remaining live controls, on an open connection: patch volume, footswitch and
 * expression-pedal assignments (SysEx writes decoded from the official editor, echoed by the unit),
 * and the MIDI Control Changes of the manual (tuner, tempo, looper, drum machine, CTRL, quick knobs),
 * which the unit does not answer. Assignments are read back: their field order is decoded from one
 * capture each.
 */
import {
  MB_EXP_ENTRIES,
  MB_FOOTSWITCHES,
  mbExpressionWrites,
  mbAssignFootswitch,
  mbAssignments,
  mbPresetLabel,
  mbSetExpressionMax,
  mbSetExpressionMin,
  mbSetPatchVolume,
  parseMbCurrentPresetNumber,
  parseMbPreset,
  mbReadCurrentPresetNumber,
  mbReadPreset,
  type MbPreset,
  type MbResolvedPreset,
} from '@pocket-master/core';
import type { MatriboxConnection } from './devices.ts';
import { EXPERIMENTAL, findBlock, findParam, knownModel } from './matribox-edit.ts';

const SWITCHES = 'ABCD';
const round = (n: number) => String(Number(n.toFixed(2)));
const experimental = (lines: readonly string[]) => [...lines, 'The change is live in the loaded preset; nothing is stored until matribox_save_preset.', EXPERIMENTAL].join('\n');
export const CC_NOTE =
  'Sent as MIDI Control Change; the unit sends no answer, so check it on the unit. It needs the unit\'s MIDI channel (global settings; Omni takes any) and "MIDI In Source" including USB. Experimental: tried on one unit so far.';

async function readLoaded(unit: MatriboxConnection): Promise<MbPreset> {
  const current = parseMbCurrentPresetNumber(await unit.read(mbReadCurrentPresetNumber()));
  return parseMbPreset(await unit.read(mbReadPreset(current)));
}

/** "A".."D" → 0..3. */
export function footswitchIndex(name: string): number {
  const index = SWITCHES.indexOf(name.trim().toUpperCase());
  if (name.trim().length !== 1 || index < 0) throw new Error(`footswitch must be A, B, C or D, got "${name}"`);
  return index;
}

/** 1..9 (as the tools number them) → 0..8. */
export function expressionEntry(entry: number): number {
  if (!Number.isInteger(entry) || entry < 1 || entry > MB_EXP_ENTRIES) throw new Error(`entry must be 1..${MB_EXP_ENTRIES}, got ${entry}`);
  return entry - 1;
}

export async function setVolume(unit: MatriboxConnection, volume: number): Promise<string> {
  const frame = mbSetPatchVolume(volume); // checked before anything is read
  const before = mbAssignments(await readLoaded(unit)).volume;
  await unit.write(frame);
  return experimental([`Patch volume ${before} → ${volume}`]);
}

/** Footswitch `footswitch` (A..D) toggles the block, or stops toggling it; checked by reading the preset back. */
export async function assignFootswitch(unit: MatriboxConnection, preset: MbResolvedPreset, options: { footswitch: string; block: string; assign: boolean }): Promise<string> {
  const index = footswitchIndex(options.footswitch);
  const block = findBlock(preset, options.block);
  await unit.write(mbAssignFootswitch(index, block.slot, options.assign));
  const slots = mbAssignments(await readLoaded(unit)).footswitches[index] ?? [];
  if (slots.includes(block.slot) !== options.assign)
    throw new Error(`the unit echoed the footswitch write, but footswitch ${SWITCHES[index]} ${options.assign ? 'does not toggle' : 'still toggles'} slot ${block.slot + 1} when read back`);
  const names = slots.map((s) => preset.chain.find((b) => b.slot === s)?.module ?? `slot ${s + 1}`);
  return experimental([`Footswitch ${SWITCHES[index]} ${options.assign ? 'now toggles' : 'no longer toggles'} ${block.position} ${block.module}. It toggles: ${names.join(', ') || 'nothing'}.`]);
}

/** Expression entry 1..9 moves a block's parameter between min and max (0..100); checked by reading section 7 back. */
export async function assignExpression(unit: MatriboxConnection, preset: MbResolvedPreset, options: { entry: number; block: string; parameter: string; min?: number; max?: number }): Promise<string> {
  const entry = expressionEntry(options.entry);
  const block = findBlock(preset, options.block);
  const model = knownModel(block);
  const param = findParam(model, options.parameter);
  const [min, max] = [options.min ?? 0, options.max ?? 100];
  for (const frame of mbExpressionWrites({ entry, slot: block.slot, paramId: param.id, min, max })) await unit.write(frame);
  const read = mbAssignments(await readLoaded(unit)).expression[entry];
  if (read?.slot !== block.slot || read.paramId !== param.id) {
    throw new Error(
      `the unit echoed the expression write, but entry ${options.entry} reads back as slot ${read?.slot ?? 'none'}, parameter ${read?.paramId}: the field order of this write may be wrong (docs/matribox.md)`,
    );
  }
  return experimental([`Expression entry ${options.entry} → ${block.position} ${block.module} ${model.name} ${param.name}, ${round(min)}..${round(max)} %`]);
}

/** Changes the heel (min) and/or toe (max) end of an expression entry, 0..100. */
export async function setExpressionRange(unit: MatriboxConnection, options: { entry: number; min?: number; max?: number }): Promise<string> {
  const entry = expressionEntry(options.entry);
  if (options.min === undefined && options.max === undefined) throw new Error('give min, max or both');
  const frames = [...(options.min === undefined ? [] : [mbSetExpressionMin(entry, options.min)]), ...(options.max === undefined ? [] : [mbSetExpressionMax(entry, options.max)])];
  for (const frame of frames) await unit.write(frame);
  const read = mbAssignments(await readLoaded(unit)).expression[entry];
  return experimental([`Expression entry ${options.entry}: ${round(read?.min ?? Number.NaN)}..${round(read?.max ?? Number.NaN)} %`]);
}

/** The assignments of the loaded preset, for matribox_get_assignments. */
export function describeAssignments(label: number, preset: MbResolvedPreset, raw: MbPreset): string {
  const a = mbAssignments(raw);
  const blockName = (slot: number) => {
    const b = preset.chain.find((c) => c.slot === slot);
    return b ? `${b.position} ${b.module}` : `slot ${slot + 1} (empty)`;
  };
  const paramName = (slot: number, id: number) => preset.chain.find((c) => c.slot === slot)?.model?.params.find((p) => p.id === id)?.name ?? `param ${id}`;
  const switches = a.footswitches.map((slots, i) => `Footswitch ${SWITCHES[i]}: ${slots.map(blockName).join(', ') || 'nothing'}`);
  const entries = a.expression
    .filter((e) => e.slot !== null)
    .map((e) => `Expression entry ${e.entry + 1}: ${blockName(e.slot as number)} ${paramName(e.slot as number, e.paramId)}, ${round(e.min)}..${round(e.max)} %`);
  return [
    `${mbPresetLabel(label)} "${preset.name}": patch volume ${a.volume}, tempo ${a.tempo} BPM, EXP 1 mode ${a.expressionMode === 1 ? 'B' : 'A'}`,
    ...switches,
    ...(entries.length ? entries : ['Expression: no entry used']),
    `Footswitches ${SWITCHES.slice(0, MB_FOOTSWITCHES).split('').join(', ')} as stomp-mode rows (section 8). Expression entries 1-3 are EXP 1 mode A, 4-6 mode B, 7-9 EXP 2.`,
  ].join('\n');
}
