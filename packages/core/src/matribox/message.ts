/**
 * Matribox II Pro messages: what the joined page payload of a frame carries (docs/matribox.md).
 *
 *   [flag u8, 0, 0, cmd u8, length u32 LE] + LZO1X stream of `length` bytes
 *
 * Every message seen, both ways, has this shape: replies (even 20-byte ones) and the host's read
 * requests alike, and `length` is always payload length − 8. A request with no argument has
 * length 0 and no stream. The decompressed data of the name tables is parsed here too.
 */
import { buildMbFrame, MB_READ } from './frame.ts';
import { lzo1xDecompress, lzo1xLiterals } from './lzo1x.ts';
import { MB_PRESET_COUNT } from './preset.ts';

export interface MbMessage {
  readonly flag: number;
  readonly cmd: number;
  readonly data: Uint8Array;
}

const HEADER_SIZE = 8;
const NAME_SIZE = 17;
const STYLE_SIZE = 10;
/** A slot table (IR, capture) holds 8 bytes per slot (zeros so far) before the names. */
const SLOT_INFO_SIZE = 8;
export const MB_IR_SLOTS = 20;
export const MB_CLONE_SLOTS = 10;

const isByte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xff;

/** Unwraps (and decompresses) one message. Throws on a bad header, length or stream. */
export function unwrapMbMessage(payload: Uint8Array, maxOut?: number): MbMessage {
  if (payload.length < HEADER_SIZE) throw new Error(`Matribox message shorter than its 8-byte header (${payload.length} bytes)`);
  if (payload[1] !== 0 || payload[2] !== 0) throw new Error('unexpected Matribox message header: bytes 1-2 must be 0');
  const length = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(4, true);
  if (length !== payload.length - HEADER_SIZE) {
    throw new Error(`Matribox message length ${length} does not match the ${payload.length - HEADER_SIZE} bytes after the header`);
  }
  const stream = payload.subarray(HEADER_SIZE);
  const data = length === 0 ? new Uint8Array(0) : lzo1xDecompress(stream, maxOut);
  return { flag: payload[0] as number, cmd: payload[3] as number, data };
}

/** A message as the host sends it: `data` stored as a literal-only LZO1X stream (none when empty). */
export function wrapMbMessage(flag: number, cmd: number, data: ArrayLike<number>): Uint8Array {
  if (!isByte(flag)) throw new Error(`flag must be a byte, got ${flag}`);
  if (!isByte(cmd)) throw new Error(`cmd must be a byte, got ${cmd}`);
  const stream = data.length === 0 ? new Uint8Array(0) : lzo1xLiterals(data);
  const header = new Uint8Array(HEADER_SIZE);
  header[0] = flag;
  header[3] = cmd;
  new DataView(header.buffer).setUint32(4, stream.length, true);
  return Uint8Array.from([...header, ...stream]);
}

/** A complete read-request frame. */
export function mbRequest(flag: number, cmd: number, arg: ArrayLike<number> = []): Uint8Array {
  return buildMbFrame(MB_READ, wrapMbMessage(flag, cmd, arg));
}

/** Preset list: 240 names and style tags. */
export const mbReadPresetNames = (): Uint8Array => mbRequest(1, 0x10, [0x00, 0x00, 0x0a, 0x01]);
/**
 * The loaded preset's patch volume: answered `03 00 05 01` + u32 0..100, the shape of the unit's
 * volume notice (waveod src/editor/preset_msgs.c, not captured). The link sends it to let a held knob notice out.
 */
export const mbReadPatchVolume = (): Uint8Array => mbRequest(1, 0x10, [0x03, 0x00, 0x05, 0x01]);
/** Argument of the current-preset-number read; the reply repeats it, then the u32 number. */
const CURRENT_PRESET_ARG = [0x01, 0x00, 0x0a, 0x01] as const;
/** The number of the loaded preset (0..239). */
export const mbReadCurrentPresetNumber = (): Uint8Array => mbRequest(1, 0x10, CURRENT_PRESET_ARG);
/**
 * A preset (1211 bytes once decompressed; the reply starts with `number`). The official editor
 * reads 0x43 and then 0x42 (the current one, 66) and got "Drive AD" both times, one byte apart:
 * whether `number` picks a stored slot or the edit buffer is not confirmed (docs/matribox.md).
 */
export function mbReadPreset(number: number): Uint8Array {
  if (!Number.isInteger(number) || number < 0 || number >= MB_PRESET_COUNT) throw new RangeError(`preset number must be 0..${MB_PRESET_COUNT - 1}, got ${number}`);
  return mbRequest(0, 0x10, [number, 0, 0, 0]);
}

/** The decompressed reply to mbReadCurrentPresetNumber: `01 00 0A 01` + u32 LE number. */
export function parseMbCurrentPresetNumber(data: Uint8Array): number {
  if (data.length !== 8) throw new Error(`current preset reply must be 8 bytes, got ${data.length}`);
  if (CURRENT_PRESET_ARG.some((b, i) => data[i] !== b)) throw new Error('current preset reply must start 01 00 0A 01');
  const number = new DataView(data.buffer, data.byteOffset, 8).getUint32(4, true);
  if (number >= MB_PRESET_COUNT) throw new Error(`current preset ${number} is out of range (240 presets)`);
  return number;
}

/** User IR slot names (20). */
export const mbReadIrNames = (): Uint8Array => mbRequest(0, 0x14);
/** Capture (clone) slot names (10). */
export const mbReadCloneNames = (): Uint8Array => mbRequest(0, 0x18);

/** A fixed-size, NUL-terminated name; bytes after the first NUL are stale and ignored. */
function readName(data: Uint8Array, at: number, size: number): string {
  const field = data.subarray(at, at + size);
  const end = field.indexOf(0);
  return String.fromCharCode(...field.subarray(0, end < 0 ? size : end));
}

export interface MbPresetName {
  readonly name: string;
  /** Style tag the unit keeps per preset ("Rock", "Metal", …; "" when unset). */
  readonly style: string;
}

/**
 * The decompressed preset list: 4 bytes (the request's argument echoed), one u32 per preset
 * (meaning unknown), then the 17-byte names, then the 10-byte style tags. Index = preset number.
 */
export function parseMbPresetNames(data: Uint8Array): readonly MbPresetName[] {
  const perPreset = 4 + NAME_SIZE + STYLE_SIZE;
  const count = (data.length - 4) / perPreset;
  if (!Number.isInteger(count) || count < 1) throw new Error(`not a preset list: ${data.length} bytes is not 4 + n × ${perPreset}`);
  const namesAt = 4 + 4 * count;
  const stylesAt = namesAt + NAME_SIZE * count;
  return Array.from({ length: count }, (_, i) => ({
    name: readName(data, namesAt + i * NAME_SIZE, NAME_SIZE),
    style: readName(data, stylesAt + i * STYLE_SIZE, STYLE_SIZE),
  }));
}

/** A slot table: 8 bytes per slot, then a 17-byte name per slot, padded to a multiple of 4. */
function parseSlotNames(data: Uint8Array, slots: number, what: string): readonly string[] {
  const size = Math.ceil((slots * (SLOT_INFO_SIZE + NAME_SIZE)) / 4) * 4;
  if (data.length !== size) throw new Error(`not a ${what} table: expected ${size} bytes, got ${data.length}`);
  const namesAt = slots * SLOT_INFO_SIZE;
  return Array.from({ length: slots }, (_, i) => readName(data, namesAt + i * NAME_SIZE, NAME_SIZE));
}

export const parseMbIrNames = (data: Uint8Array): readonly string[] => parseSlotNames(data, MB_IR_SLOTS, 'user IR');
export const parseMbCloneNames = (data: Uint8Array): readonly string[] => parseSlotNames(data, MB_CLONE_SLOTS, 'capture');
