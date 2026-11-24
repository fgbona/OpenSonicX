/**
 * Matribox II Pro write frames (live edits of the loaded preset, preset select, save), rebuilt from
 * the official editor's traffic (docs/matribox.md, "Writes"). Every write is a flag-1 message,
 * cmd 0x10 except save (0x05), in a type-0x12 frame; the unit echoes each one back.
 *
 * Set param, on/off and select are byte-exact with captured host frames. Chain changes, the
 * assignment tables and save are rebuilt from the unit's echoes only. None of them has been sent
 * by this code to a real unit yet: experimental until the owner validates them on the hardware.
 */
import { buildMbFrame, float32LE, MB_WRITE } from './frame.ts';
import { wrapMbMessage } from './message.ts';
import { MB_PRESET_COUNT, type MbPreset } from './preset.ts';

export const MB_SLOTS = 12;
/** Values per slot in sec5: parameter ids are 0..14. */
const PARAMS_PER_SLOT = 15;
const MODULES = 16;
const NO_SLOT = 0xff;
const NAME_FIELD = 17;
const SET_CMD = 0x10;
const SAVE_CMD = 0x05;

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

export interface MbChainBlock {
  /** Storage slot 0..11. */
  readonly slot: number;
  /** Catalog module index (DYN 0 … VOL 15). */
  readonly moduleIndex: number;
  readonly fxid: number;
  readonly on: boolean;
}

/**
 * The whole chain of the loaded preset (sec4 from byte 4, then one on/off byte per slot, then
 * `focus`): blocks in signal order; slots not listed are emptied. The official editor sets
 * `focus` to the slot it added, changed or removed, and to FF for a reorder (meaning unconfirmed).
 */
export function mbSetChain(blocks: readonly MbChainBlock[], focus: number = NO_SLOT): Uint8Array {
  if (blocks.length < 1 || blocks.length > MB_SLOTS) fail(`a chain holds at least one and at most ${MB_SLOTS} blocks, got ${blocks.length}`);
  blocks.forEach((b, i) => {
    checkSlot(b.slot);
    if (blocks.findIndex((o) => o.slot === b.slot) !== i) fail(`slot ${b.slot} is used twice`);
    if (!isIn(b.moduleIndex, MODULES)) fail(`module index must be 0..${MODULES - 1}, got ${b.moduleIndex}`);
    if (!Number.isInteger(b.fxid) || b.fxid < 0 || b.fxid > 0xffffffff) fail(`fxid must be a u32, got ${b.fxid}`);
  });
  if (focus !== NO_SLOT && !isIn(focus, MB_SLOTS)) fail(`focus must be a slot 0..${MB_SLOTS - 1} or 0xff, got ${focus}`);
  const bySlot = (slot: number) => blocks.find((b) => b.slot === slot);
  const slots = Array.from({ length: MB_SLOTS }, (_, slot) => bySlot(slot));
  const order = Array.from({ length: MB_SLOTS }, (_, i) => blocks[i]?.slot ?? NO_SLOT);
  return write(SET_CMD, [
    0x00, 0x00, 0x04, 0x01,
    ...order,
    ...slots.map((b) => b?.moduleIndex ?? NO_SLOT),
    ...slots.flatMap((b) => u32(b?.fxid ?? 0)),
    ...slots.map((b) => (b?.on ? 1 : 0)),
    focus,
  ]);
}

/** sec2, sec7 and sec8 of a preset with no assignments (what the unit's empty preset 60D holds). */
const EMPTY_TABLES = [
  ...[0xff, 0xff, 0x0d, 0x00, 0x00, 0x00], // sec2 from byte 4
  ...Array<number>(9).fill(0xff), ...Array<number>(9).fill(0), // sec7 from byte 5: 9 targets, 9 param ids,
  ...Array<number>(36).fill(0), ...Array.from({ length: 9 }, () => [...float32LE(100)]).flat(), // 9 min, 9 max
  ...Array<number>(60).fill(0), // sec8 from byte 9: footswitch × slot flags
];

/**
 * The official editor sends this before every chain change except a reorder: `04 00 04 01` + sec2
 * from byte 4 + sec7 from byte 5 + sec8 from byte 9 (160 bytes; likely the expression-pedal and
 * footswitch assignments, which name slots). Only the empty preset's tables were captured; that
 * the bytes are those tables, split this way, is a hypothesis (sec2[9] and sec7[4] are 0 in every
 * sample, so the split could be one byte off). Without a preset: the empty tables.
 */
export function mbSetAssignments(preset?: MbPreset): Uint8Array {
  const body = (id: number) => preset?.sections.find((s) => s.id === id)?.body ?? fail(`preset has no section ${id}`);
  const tables = preset === undefined
    ? EMPTY_TABLES
    : [...body(2).subarray(4, 10), ...body(7).subarray(5, 95), ...body(8).subarray(9, 69)];
  return write(SET_CMD, [0x04, 0x00, 0x04, 0x01, ...tables]);
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
