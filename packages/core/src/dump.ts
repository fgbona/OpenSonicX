import { blockByModule, findCloneModel, findModel, CLONE_MODULE, type ModelSpec, type ParamSpec } from './catalog.ts';
import type { Footswitch } from './commands.ts';
import { MessageType, Query } from './queries.ts';
import { toHex } from './hex.ts';

/**
 * Edit-buffer dump (reply to 12 41):
 *   12 41, uint16 0x00ff, uint16 header_len, header records, groups...
 *   record = uint16 tag, uint16 length, data. A group is a record whose data are records.
 */
const Tag = { VOLUME: 0x2001, BPM: 0x2002, STATES: 0x3001, CHAIN: 0x3002, EFFECTS: 0x3003, PARAMS: 0x3004 } as const;
/** Group holding the two footswitch masks (u32 FS1, u32 FS2; bit n = module n). Layout from SonicMaster (MIT). */
const FOOTSWITCH_GROUP = 0x0003;
const REQUIRED = [Tag.STATES, Tag.CHAIN, Tag.EFFECTS, Tag.PARAMS];
/** Smallest record sizes the decoder reads: mask, 9 chain bytes, 10 codes, 10 x 8 floats. */
const MIN_SIZE: ReadonlyMap<number, number> = new Map([
  [Tag.STATES, 4], [Tag.CHAIN, 9], [Tag.EFFECTS, 40], [Tag.PARAMS, 320], [Tag.VOLUME, 4], [Tag.BPM, 4],
]);
const MODULE_COUNT = 9;
const PARAM_STRIDE = 32; // 8 x float32 per module
const RECORD_HEADER = 4;
const AMP_MODE_BIT = 9;
const AMP_MODULE = 3;

export interface Param {
  readonly name: string;
  /** Parameter slot inside the module (0..7); what a set-parameter command addresses. */
  readonly alg: number;
  readonly kind: 'number' | 'switch' | 'select';
  readonly value: number;
  readonly display: string;
  /** Range of a number parameter, from the catalog. */
  readonly min?: number;
  readonly max?: number;
}

export interface Block {
  readonly key: string;
  readonly label: string;
  readonly module: number;
  readonly on: boolean;
  /** Footswitch that toggles this block, or null. */
  readonly footswitch: Footswitch | null;
  /** Model name, or the effect code in hex when the catalog does not know it. */
  readonly model: string;
  readonly code: number;
  readonly params: readonly Param[];
}

export interface Preset {
  readonly volume: number | null;
  /** Tempo, 40..260; null when the dump has no BPM record. */
  readonly bpm: number | null;
  readonly ampMode: 'normal' | 'clone';
  /** Blocks in signal-chain order. */
  readonly chain: readonly Block[];
}

export function decodePreset(payload: Uint8Array): Preset {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.EDIT_BUFFER || payload.length < 6) {
    throw new Error('not an edit-buffer dump (expected payload 12 41 …)');
  }
  const { tags, groups } = readDump(payload);
  const missing = REQUIRED.filter((t) => !tags.has(t));
  if (missing.length > 0) {
    throw new Error(`edit-buffer dump is missing records ${missing.map((t) => '0x' + t.toString(16)).join(', ')}`);
  }
  // Only records that are present are size-checked; whether one is mandatory is REQUIRED's job (volume is optional).
  for (const [tag, size] of MIN_SIZE) {
    const data = tags.get(tag);
    if (data && data.length < size) throw new Error(`edit-buffer dump record 0x${tag.toString(16)} is too short (${data.length} < ${size} bytes)`);
  }
  const view = (tag: number) => dataView(tags.get(tag) as Uint8Array);
  const mask = view(Tag.STATES).getUint32(0, true);
  const codes = view(Tag.EFFECTS);
  const params = view(Tag.PARAMS);
  const ampMode = (mask >> AMP_MODE_BIT) & 1 ? 'clone' : 'normal';
  const order = readChain(tags.get(Tag.CHAIN) as Uint8Array);
  const volume = tags.has(Tag.VOLUME) ? view(Tag.VOLUME).getUint32(0, true) : null;
  const bpm = tags.has(Tag.BPM) ? view(Tag.BPM).getUint32(0, true) : null;
  const switches = groups.get(FOOTSWITCH_GROUP);
  const masks = switches && switches.length >= 8 ? [dataView(switches).getUint32(0, true), dataView(switches).getUint32(4, true)] : [0, 0];
  const footswitchOf = (module: number): Footswitch | null =>
    (masks[0]! >> module) & 1 ? 'fs1' : (masks[1]! >> module) & 1 ? 'fs2' : null;

  const chain = order.map((module) => {
    // ponytail: in clone mode the AMP slot is read from module 9 (code and params); not yet verified on hardware.
    const source = module === AMP_MODULE && ampMode === 'clone' ? CLONE_MODULE : module;
    const spec = blockByModule(module);
    const key = spec?.key ?? `m${module}`;
    const code = codes.getUint32(4 * source, true);
    const model = source === CLONE_MODULE ? findCloneModel(code) : findModel(key, code);
    return {
      key,
      label: spec?.label ?? key.toUpperCase(),
      module,
      on: ((mask >> module) & 1) === 1,
      footswitch: footswitchOf(module),
      model: model?.name ?? `0x${code.toString(16).toUpperCase().padStart(8, '0')}`,
      code,
      params: decodeParams(model, params, source),
    };
  });
  return { volume, bpm, ampMode, chain };
}

function decodeParams(model: ModelSpec | undefined, view: DataView, module: number): Param[] {
  if (!model) return [];
  return model.params
    .filter((p) => view.byteLength >= PARAM_STRIDE * module + 4 * p.alg + 4)
    .map((p) => toParam(p, view.getFloat32(PARAM_STRIDE * module + 4 * p.alg, true)));
}

/** A decoded parameter for a catalog spec and a raw value. */
export function toParam(p: ParamSpec, value: number): Param {
  const kind = p.type ?? 'number';
  const range = kind === 'number' ? { min: p.min ?? 0, max: p.max ?? 100 } : {};
  return { name: p.name, alg: p.alg, kind, value: round(value, decimals(p)), display: formatValue(p, value), ...range };
}

/** Catalog model of a block in a preset; AMP in clone mode resolves to a captured profile. */
export function modelOf(preset: Preset, block: Block): ModelSpec | undefined {
  if (block.module === AMP_MODULE && preset.ampMode === 'clone') return findCloneModel(block.code);
  return findModel(block.key, block.code);
}

export function formatValue(p: ParamSpec, value: number): string {
  if (p.type === 'switch') return value >= 0.5 ? 'on' : 'off';
  if (p.type === 'select') return p.options?.[Math.round(value)] ?? String(Math.round(value));
  const text = round(value, decimals(p)).toString();
  return p.unit ? `${text} ${p.unit}` : text;
}

function decimals(p: ParamSpec): number {
  const step = p.step ?? 1;
  return Number.isInteger(step) ? 0 : (step.toString().split('.')[1]?.length ?? 0);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function readChain(data: Uint8Array): number[] {
  const order = Array.from(data.subarray(0, MODULE_COUNT));
  const valid = [...order].sort((a, b) => a - b).every((m, i) => m === i);
  if (!valid) throw new Error(`invalid chain order in dump: ${toHex(data)}`);
  return order;
}

function readDump(payload: Uint8Array): { tags: Map<number, Uint8Array>; groups: Map<number, Uint8Array> } {
  const headerLen = dataView(payload).getUint16(4, true);
  const tags = new Map<number, Uint8Array>();
  const groups = new Map<number, Uint8Array>();
  for (const group of records(payload, 6 + headerLen, payload.length)) {
    groups.set(group.tag, group.data);
    for (const rec of records(group.data, 0, group.data.length)) tags.set(rec.tag, rec.data);
  }
  return { tags, groups };
}

function records(buf: Uint8Array, start: number, end: number): { tag: number; data: Uint8Array }[] {
  const view = dataView(buf);
  const out: { tag: number; data: Uint8Array }[] = [];
  for (let o = start; o + RECORD_HEADER <= end; ) {
    const tag = view.getUint16(o, true);
    const length = view.getUint16(o + 2, true);
    if (o + RECORD_HEADER + length > end) break;
    out.push({ tag, data: buf.subarray(o + RECORD_HEADER, o + RECORD_HEADER + length) });
    o += RECORD_HEADER + length;
  }
  return out;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
