/**
 * Matribox II Pro write frames (live edits of the loaded preset, preset select, save), rebuilt from
 * the official editor's traffic (docs/matribox.md, "Writes"). Every write is a flag-1 message,
 * cmd 0x10 except save (0x05), in a type-0x12 frame. The unit echoes set param, on/off and select;
 * it answers a chain edit (add, move, remove, change model) with its chain notice, and a save with
 * nothing (check it by reading the slot back).
 *
 * Every builder is byte-exact with a captured host frame. Hardware-validated on the owner's unit
 * (2026-11-24): every builder here but the whole preset and the live controls at the end (patch
 * volume, footswitch and expression assignments: captures mb-01, mb-09, mb-04, not yet sent by us).
 */
import { buildMbFrame, buildMbFrames, float32LE, MB_WRITE } from './frame.ts';
import { wrapMbMessage } from './message.ts';
import { MB_PRESET_COUNT, mbPresetBody, type MbPreset } from './preset.ts';

export const MB_SLOTS = 12;
/** Values per slot in sec5: parameter ids are 0..14. */
const PARAMS_PER_SLOT = 15;
const MODULES = 16;
const NO_SLOT = 0xff;
const NAME_FIELD = 17;
const SET_CMD = 0x10;
const SAVE_CMD = 0x05;
/** The official editor's whole-preset write is the only flag-2 message seen. */
const WHOLE_PRESET_FLAG = 2;

const fail = (msg: string): never => {
  throw new RangeError(`Matribox write: ${msg}`);
};
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const write = (cmd: number, data: readonly number[]) => buildMbFrame(MB_WRITE, wrapMbMessage(1, cmd, data));
const isIn = (n: number, size: number) => Number.isInteger(n) && n >= 0 && n < size;

function checkSlot(slot: number): number {
  return isIn(slot, MB_SLOTS) ? slot : fail(`slot must be 0..${MB_SLOTS - 1}, got ${slot}`);
}

function checkPreset(index: number): number {
  return isIn(index, MB_PRESET_COUNT) ? index : fail(`preset index must be 0..${MB_PRESET_COUNT - 1}, got ${index}`);
}

/** One parameter of a storage slot (not a chain position) in the loaded preset: `01 00 05 01` + slot + id + f32. */
export function mbSetParam(slot: number, paramId: number, value: number): Uint8Array {
  checkSlot(slot);
  if (!isIn(paramId, PARAMS_PER_SLOT)) fail(`parameter id must be 0..${PARAMS_PER_SLOT - 1}, got ${paramId}`);
  if (!Number.isFinite(value)) fail(`value must be a finite number, got ${value}`);
  return write(SET_CMD, [0x01, 0x00, 0x05, 0x01, ...u32(slot), ...u32(paramId), ...float32LE(value)]);
}

/** Turns a storage slot's block on or off: `02 00 05 01` + slot + state. */
export function mbSetBlockOn(slot: number, on: boolean): Uint8Array {
  return write(SET_CMD, [0x02, 0x00, 0x05, 0x01, ...u32(checkSlot(slot)), ...u32(on ? 1 : 0)]);
}

/** Loads preset `index` (0..239; label 1A = 0 … 60D = 239). Unsaved edits are lost. */
export function mbSelectPreset(index: number): Uint8Array {
  return write(SET_CMD, [0x01, 0x00, 0x0a, 0x01, ...u32(checkPreset(index))]);
}

/** A chain edit: `01 00 04 01` + from + to + module + fxid. NONE as `from` adds, NONE as `to` removes. */
function chainEdit(from: number, to: number, moduleIndex: number, fxid: number): Uint8Array {
  return write(SET_CMD, [0x01, 0x00, 0x04, 0x01, from, to, moduleIndex, ...u32(fxid)]);
}

function checkPosition(position: number): number {
  return isIn(position, MB_SLOTS) ? position : fail(`chain position must be 0..${MB_SLOTS - 1}, got ${position}`);
}

function checkModel(moduleIndex: number, fxid: number): void {
  if (!isIn(moduleIndex, MODULES)) fail(`module index must be 0..${MODULES - 1}, got ${moduleIndex}`);
  if (!Number.isInteger(fxid) || fxid < 0 || fxid > 0xffffffff) fail(`fxid must be a u32, got ${fxid}`);
}

/** Inserts a block of `moduleIndex`/`fxid` at 0-based chain `position`; the unit picks the slot and loads the model's defaults. */
export function mbAddBlock(position: number, moduleIndex: number, fxid: number): Uint8Array {
  checkModel(moduleIndex, fxid);
  return chainEdit(NO_SLOT, checkPosition(position), moduleIndex, fxid);
}

/** Moves the block at chain position `from` to position `to`. */
export function mbMoveBlock(from: number, to: number): Uint8Array {
  return chainEdit(checkPosition(from), checkPosition(to), NO_SLOT, 0xffffffff);
}

/** Removes the block at chain `position`. */
export function mbRemoveBlock(position: number): Uint8Array {
  return chainEdit(checkPosition(position), NO_SLOT, 0, 0);
}

/**
 * Swaps the model of the block in storage `slot` (`02 00 04 01` + slot + module + fxid), like set
 * param and on/off; the unit loads the new model's defaults. Slot, not chain position: checked on
 * the owner's unit with a block whose slot and position differ.
 */
export function mbChangeModel(slot: number, moduleIndex: number, fxid: number): Uint8Array {
  checkModel(moduleIndex, fxid);
  return write(SET_CMD, [0x02, 0x00, 0x04, 0x01, checkSlot(slot), moduleIndex, ...u32(fxid)]);
}

/** Printable ASCII, 1..16 characters: the unit's 17-byte, NUL-terminated name field. */
export function checkMbPresetName(name: string): string {
  return /^[\x20-\x7e]{1,16}$/.test(name) && name.trim() !== '' ? name : fail(`preset name must be 1..16 printable ASCII characters, got "${name}"`);
}

/**
 * cmd 0x05: u32 index + 17-byte name. Seen once storing the loaded preset as 60D "TESTE OSX" (capture
 * 2), and once in capture 1 with the next preset's own name before a select. UNVERIFIED as "save the
 * loaded preset to `index`": gate it behind a confirmation and back up the target first.
 */
export function mbSavePreset(index: number, name: string): Uint8Array {
  const chars = Array.from(checkMbPresetName(name), (c) => c.charCodeAt(0));
  return write(SAVE_CMD, [...u32(checkPreset(index)), ...chars, ...Array<number>(NAME_FIELD - chars.length).fill(0)]);
}

/**
 * The whole preset in one message, as the official editor sends a .prst it imports (capture mb-20,
 * not yet sent by us to the unit): flag 2, cmd 0x10, u32 `index` + the 1207-byte body with the
 * .prst section tags, paged (183 bytes per frame). The unit answers flag 0, cmd 0x17, `02 00 00 10`.
 * The editor selected `index` first and then re-read it, which showed the new preset: whether the
 * write also stores the slot is not known, so store it with mbSavePreset.
 */
export function mbWritePreset(index: number, preset: MbPreset): Uint8Array[] {
  const data = [...u32(checkPreset(index)), ...mbPresetBody(preset)];
  return buildMbFrames(MB_WRITE, wrapMbMessage(WHOLE_PRESET_FLAG, SET_CMD, data));
}

/** Footswitches A..D (A = 0). Section 8 has a fifth row, not known yet (CTRL?): not offered. */
export const MB_FOOTSWITCHES = 4;
/** Expression-pedal entries in section 7 (likely EXP 1 mode A 0..2, mode B 3..5, EXP 2 6..8; not confirmed). */
export const MB_EXP_ENTRIES = 9;
const PERCENT = 100;

function checkPercent(what: string, value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= PERCENT ? value : fail(`${what} must be 0..${PERCENT}, got ${value}`);
}

function checkEntry(entry: number): number {
  return isIn(entry, MB_EXP_ENTRIES) ? entry : fail(`expression entry must be 0..${MB_EXP_ENTRIES - 1}, got ${entry}`);
}

/** The loaded preset's patch volume, 0..100 (capture mb-01: streamed while dragging, echoed): `03 00 05 01` + u32. */
export function mbSetPatchVolume(volume: number): Uint8Array {
  if (!Number.isInteger(volume)) fail(`patch volume must be an integer, got ${volume}`);
  return write(SET_CMD, [0x03, 0x00, 0x05, 0x01, ...u32(checkPercent('patch volume', volume))]);
}

/**
 * Makes footswitch `footswitch` (A = 0 … D = 3) toggle storage `slot`, or stops it (capture mb-09,
 * stomp mode): `01 00 08 01` + u32 switch + u32 slot + u32 1/0. A switch may toggle several slots.
 */
export function mbAssignFootswitch(footswitch: number, slot: number, assigned: boolean): Uint8Array {
  if (!isIn(footswitch, MB_FOOTSWITCHES)) fail(`footswitch must be 0..${MB_FOOTSWITCHES - 1} (A..D), got ${footswitch}`);
  return write(SET_CMD, [0x01, 0x00, 0x08, 0x01, ...u32(footswitch), ...u32(checkSlot(slot)), ...u32(assigned ? 1 : 0)]);
}

export interface MbExpressionAssignment {
  /** Section 7 entry 0..8. */
  readonly entry: number;
  /** Storage slot of the block the pedal moves. */
  readonly slot: number;
  /** Catalog widget ID of the parameter. */
  readonly paramId: number;
  /** Heel and toe ends, 0..100 (the official editor's slider values). */
  readonly min: number;
  readonly max: number;
}

/**
 * Points expression-pedal entry `entry` at a block's parameter (capture mb-04): `02 00 07 01` + u32
 * entry + u32 slot + u32 param + u32 0 + f32 min + f32 max. The capture had every u32 at 0 (entry 0,
 * DRV in slot 0, Gain = ID 0), so the order of the first three is the owner's reading, not proven:
 * the MCP server reads section 7 back after it.
 */
export function mbAssignExpression({ entry, slot, paramId, min, max }: MbExpressionAssignment): Uint8Array {
  if (!isIn(paramId, PARAMS_PER_SLOT)) fail(`parameter id must be 0..${PARAMS_PER_SLOT - 1}, got ${paramId}`);
  const ends = [...float32LE(checkPercent('expression min', min)), ...float32LE(checkPercent('expression max', max))];
  return write(SET_CMD, [0x02, 0x00, 0x07, 0x01, ...u32(checkEntry(entry)), ...u32(checkSlot(slot)), ...u32(paramId), ...u32(0), ...ends]);
}

/** One end of an expression entry: `03 00 07 01` (min) or `04 00 07 01` (max) + u32 entry + u32 0 (unknown) + f32. */
function expressionEnd(op: number, what: string, entry: number, value: number): Uint8Array {
  return write(SET_CMD, [op, 0x00, 0x07, 0x01, ...u32(checkEntry(entry)), ...u32(0), ...float32LE(checkPercent(what, value))]);
}

export const mbSetExpressionMin = (entry: number, value: number): Uint8Array => expressionEnd(0x03, 'expression min', entry, value);
export const mbSetExpressionMax = (entry: number, value: number): Uint8Array => expressionEnd(0x04, 'expression max', entry, value);
