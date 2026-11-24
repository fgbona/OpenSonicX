/**
 * Matribox II Pro presets (decode only), from our captures and 22 sample presets (docs/matribox.md).
 *
 * A preset is 9 sections, each `u32 tag` + `u32 length` + body, with fixed ids and sizes. A device
 * read adds a u32 header (the number it was read with) in front: 1211 bytes. A .prst file holds the
 * sections alone (1207 bytes). Every section is kept raw, so writeMatriboxPrst serializes it back.
 *
 *   sec1: name at 8 (NUL-terminated, stale bytes after it), style tag at 95
 *   sec4: chain order (12 slot numbers, ff = none) at 4, module index per slot at 16, u32 fxid per slot at 28
 *   sec5: 15 float32 per slot at 4 + slot·60 (index = catalog widget ID), on/off byte per slot at 724
 *
 * Positions a model does not use keep stale values from earlier models: read only the model's widget IDs.
 */
import type { MbCatalog, MbModel } from './catalog.ts';
import { lzo1xDecompress, lzo1xLiterals } from './lzo1x.ts';

export const MB_PRESET_BODY_SIZE = 1207;
/** A preset as the unit sends it: the u32 number, then the body. */
export const MB_PRESET_SIZE = MB_PRESET_BODY_SIZE + 4;
export const MB_PRESET_COUNT = 240;
const SLOTS = 12;
const VALUES_PER_SLOT = 15;
const NO_SLOT = 0xff;
/** Section tags: 0x10000000 on the device, 0x10000002 in .prst files. */
const TAGS = [0x10000000, 0x10000002];
const PRST_TAG = 0x10000002;
const LAYOUT: readonly (readonly [id: number, size: number])[] = [
  [0, 11],
  [1, 105],
  [2, 10],
  [3, 15],
  [4, 76],
  [5, 742],
  [7, 95],
  [8, 69],
  [9, 12],
];

export interface MbSection {
  readonly tag: number;
  readonly id: number;
  /** The whole body, its 4-byte `00 00 id 01` head included. */
  readonly body: Uint8Array;
}

export interface MbBlock {
  /** Storage slot 0..11 (not the chain position); live edits address it. */
  readonly slot: number;
  /** Catalog module index (DYN 0 … VOL 15). */
  readonly moduleIndex: number;
  readonly fxid: number;
  readonly on: boolean;
  /** The slot's 15 float32 values, indexed by catalog widget ID (unused positions are stale). */
  readonly values: readonly number[];
}

export interface MbPreset {
  /** The u32 a device read carries (the number it was read with); null for a .prst. */
  readonly number: number | null;
  readonly name: string;
  readonly style: string;
  /** Blocks in signal order, input to output. */
  readonly chain: readonly MbBlock[];
  readonly sections: readonly MbSection[];
}

const fail = (msg: string): never => {
  throw new Error(`Matribox preset: ${msg}`);
};

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end));
}

function readSections(data: Uint8Array): readonly MbSection[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  return LAYOUT.map(([id, size]) => {
    const tag = view.getUint32(at, true);
    if (!TAGS.includes(tag)) fail(`section ${id} has an unknown tag 0x${tag.toString(16)}`);
    const length = view.getUint32(at + 4, true);
    if (length !== size) fail(`section ${id} length is ${length}, expected ${size}`);
    const body = data.slice(at + 8, at + 8 + size);
    if (body[0] !== 0 || body[1] !== 0 || body[2] !== id) fail(`expected section ${id} at offset ${at}`);
    at += 8 + size;
    return Object.freeze({ tag, id, body });
  });
}

function readChain(sec4: Uint8Array, sec5: Uint8Array): readonly MbBlock[] {
  const view4 = new DataView(sec4.buffer, sec4.byteOffset, sec4.byteLength);
  const view5 = new DataView(sec5.buffer, sec5.byteOffset, sec5.byteLength);
  const order = Array.from(sec4.subarray(4, 4 + SLOTS)).filter((s) => s !== NO_SLOT);
  return order.map((slot, i) => {
    if (slot >= SLOTS) fail(`chain names slot ${slot} (0..${SLOTS - 1})`);
    if (order.indexOf(slot) !== i) fail(`chain names slot ${slot} twice`);
    const moduleIndex = sec4[16 + slot] as number;
    if (moduleIndex === NO_SLOT) fail(`chain slot ${slot} has no module`);
    const values = Array.from({ length: VALUES_PER_SLOT }, (_, id) => view5.getFloat32(4 + slot * VALUES_PER_SLOT * 4 + id * 4, true));
    return Object.freeze({
      slot,
      moduleIndex,
      fxid: view4.getUint32(28 + 4 * slot, true),
      on: sec5[4 + SLOTS * VALUES_PER_SLOT * 4 + slot] !== 0,
      values: Object.freeze(values),
    });
  });
}

/** Parses a decompressed preset: 1211 bytes from the unit (u32 number + body) or a 1207-byte body. */
export function parseMbPreset(data: Uint8Array): MbPreset {
  if (data.length !== MB_PRESET_SIZE && data.length !== MB_PRESET_BODY_SIZE) {
    fail(`expected ${MB_PRESET_SIZE} or ${MB_PRESET_BODY_SIZE} bytes, got ${data.length}`);
  }
  const hasNumber = data.length === MB_PRESET_SIZE;
  const number = hasNumber ? new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) : null;
  const sections = Object.freeze(readSections(hasNumber ? data.subarray(4) : data));
  const body = (id: number) => (sections.find((s) => s.id === id) as MbSection).body;
  const sec1 = body(1);
  return Object.freeze({
    number,
    name: cString(sec1.subarray(8, 24)),
    style: cString(sec1.subarray(95)),
    chain: Object.freeze(readChain(body(4), body(5))),
    sections,
  });
}

/** A .prst file exported by Sonicake's official editor: base64 of a JSON byte array that is a raw LZO1X stream. */
export function parseMatriboxPrst(fileText: string): MbPreset {
  const text = fileText.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) fail('not a .prst file (expected base64 text)');
  let json: unknown;
  try {
    json = JSON.parse(atob(text));
  } catch {
    return fail('not a .prst file (its base64 does not hold JSON)');
  }
  if (!Array.isArray(json) || json.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) fail('a .prst must hold a JSON byte array');
  const data = lzo1xDecompress(Uint8Array.from(json as number[]), MB_PRESET_SIZE);
  if (data.length !== MB_PRESET_BODY_SIZE) fail(`a .prst holds ${MB_PRESET_BODY_SIZE} bytes, got ${data.length}`);
  return parseMbPreset(data);
}

/**
 * The 1207-byte body of `preset`: its 9 sections, each tagged 0x10000002 as in a .prst and in the
 * official editor's whole-preset write (capture mb-20). A device preset's u32 number is dropped.
 */
export function mbPresetBody(preset: MbPreset): Uint8Array {
  const body = new Uint8Array(MB_PRESET_BODY_SIZE);
  const view = new DataView(body.buffer);
  let at = 0;
  for (const section of preset.sections) {
    if (at + 8 + section.body.length > MB_PRESET_BODY_SIZE) fail(`sections hold more than ${MB_PRESET_BODY_SIZE} bytes`);
    view.setUint32(at, PRST_TAG, true);
    view.setUint32(at + 4, section.body.length, true);
    body.set(section.body, at + 8);
    at += 8 + section.body.length;
  }
  if (at !== MB_PRESET_BODY_SIZE) fail(`sections hold ${at} bytes, expected ${MB_PRESET_BODY_SIZE}`);
  return body;
}

/**
 * A .prst file as Sonicake's official editor reads it (the inverse of parseMatriboxPrst): the body
 * (mbPresetBody) as a literal-only LZO1X stream (valid LZO1X, just not compressed), as a JSON byte
 * array, as base64.
 */
export function writeMatriboxPrst(preset: MbPreset): string {
  return btoa(JSON.stringify(Array.from(lzo1xLiterals(mbPresetBody(preset)))));
}

export interface MbResolvedParam {
  readonly name: string;
  readonly id: number;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export interface MbResolvedBlock {
  /** 1-based position in the chain. */
  readonly position: number;
  readonly slot: number;
  /** Module name from the catalog ("DRV", "AMP", …), or "module <n>" when unknown. */
  readonly module: string;
  readonly moduleIndex: number;
  readonly fxid: number;
  /** null when the catalog has no such model: the fxid is kept raw. */
  readonly model: MbModel | null;
  readonly on: boolean;
  /** The model's parameters only, in catalog order. */
  readonly params: readonly MbResolvedParam[];
}

export interface MbResolvedPreset {
  readonly number: number | null;
  readonly name: string;
  readonly style: string;
  readonly chain: readonly MbResolvedBlock[];
}

/** Names a preset's blocks, models and parameters from the catalog. */
export function resolveMbPreset(preset: MbPreset, catalog: MbCatalog): MbResolvedPreset {
  const chain = preset.chain.map((block, i) => {
    const module = catalog.modules.find((m) => m.index === block.moduleIndex);
    const model = module?.models.find((m) => m.fxid === block.fxid) ?? null;
    const params = (model?.params ?? []).map((p) => Object.freeze({ name: p.name, id: p.id, value: block.values[p.id] ?? Number.NaN, min: p.min, max: p.max }));
    return Object.freeze({
      position: i + 1,
      slot: block.slot,
      module: module?.name ?? `module ${block.moduleIndex}`,
      moduleIndex: block.moduleIndex,
      fxid: block.fxid,
      model,
      on: block.on,
      params: Object.freeze(params),
    });
  });
  return Object.freeze({ number: preset.number, name: preset.name, style: preset.style, chain: Object.freeze(chain) });
}

/** "1A".."60D": four presets (A..D) per bank. */
export function mbPresetLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MB_PRESET_COUNT) throw new RangeError(`preset index must be 0..${MB_PRESET_COUNT - 1}, got ${index}`);
  return `${Math.floor(index / 4) + 1}${'ABCD'[index % 4]}`;
}

/** The index of a label "1A".."60D" (case-insensitive): (bank - 1) × 4 + letter. */
export function parseMbPresetLabel(label: string): number {
  const match = /^(\d{1,2})([A-D])$/i.exec(label.trim());
  const bank = Number(match?.[1]);
  if (!match || bank < 1 || bank > MB_PRESET_COUNT / 4) throw new RangeError(`not a Matribox preset label: "${label}" (1A..60D)`);
  return (bank - 1) * 4 + 'ABCD'.indexOf((match[2] as string).toUpperCase());
}
