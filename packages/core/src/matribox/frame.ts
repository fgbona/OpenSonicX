/**
 * Sonicake Matribox II Pro SysEx framing (Valeton GP-200 platform), from captures of the
 * owner's unit (docs/matribox.md):
 *
 *   F0 21 25 4D 50 00 00 <ck> <type> <len lo> <len hi> <off lo> <off hi> <nibbles…> F7
 *
 * type 0x11 = read request and 0x12 = write (host), 0x00 = reply or notification (unit).
 * len = total decoded length of the message, off = where this page starts (both 7-bit lo, hi).
 * Each data byte travels as two nibbles, high first. A long reply comes as pages of 185 bytes, a
 * long host message (the official editor's whole-preset write) as pages of 183.
 * Host frames: ck = sum of the data nibbles (after off hi, up to F7) & 0x7F; a paged host write
 * (capture mb-20) shows that length and offset bytes are not summed. Replies use another rule not
 * decoded yet, so their checksum is kept but not checked.
 */
import { collapse, expand, SYSEX_END, SYSEX_START } from '../frame.ts';

export const MATRIBOX_PORT_NAME = 'Matribox II PRO';
export const MB_READ = 0x11;
export const MB_WRITE = 0x12;
export const MB_REPLY = 0x00;
export type MbType = typeof MB_READ | typeof MB_WRITE | typeof MB_REPLY;
/** Decoded bytes in one full page. */
export const MB_PAGE_SIZE = 185;
/** Decoded bytes in one full host page: the official editor's paged write (capture mb-20). */
export const MB_HOST_PAGE_SIZE = 183;
/** "~GP-2" probe the official editor sends first; the unit does not answer it. */
export const MB_PROBE: Uint8Array = Uint8Array.from([0xf0, 0x21, 0x25, 0x7e, 0x47, 0x50, 0x2d, 0x32, 0x11, 0x12, 0x00, 0x00, 0x00, 0xf7]);

const HEADER = [SYSEX_START, 0x21, 0x25, 0x4d, 0x50, 0x00, 0x00] as const;
const CK_AT = HEADER.length; // 7
const TYPE_AT = CK_AT + 1; // 8
const DATA_AT = TYPE_AT + 5; // 13: after type, len lo/hi, off lo/hi

export interface MbFrame {
  readonly type: MbType;
  /** Decoded length of the whole message (all pages). */
  readonly total: number;
  /** Where this page's payload starts in the whole message. */
  readonly offset: number;
  readonly payload: Uint8Array;
  readonly checksum: number;
  /** Host frames only: whether the checksum matches. null for replies (rule not decoded). */
  readonly checksumOk: boolean | null;
}

/** Checksum of a host frame over its data nibbles (every byte after off hi, excluding F7). */
export function mbChecksum(tail: ArrayLike<number>): number {
  return Array.from(tail).reduce((sum, b) => sum + b, 0) & 0x7f;
}

const join7 = (lo: number, hi: number) => lo | (hi << 7);
const isType = (t: number): t is MbType => t === MB_READ || t === MB_WRITE || t === MB_REPLY;

/** Complete single-page SysEx message for a host read or write. */
export function buildMbFrame(type: MbType, payload: ArrayLike<number>): Uint8Array {
  const bytes = hostBytes(type, payload);
  if (bytes.length > MB_PAGE_SIZE) throw new Error(`payload too long for one page (${bytes.length} > ${MB_PAGE_SIZE}): use buildMbFrames`);
  return page(type, bytes, bytes.length, 0);
}

function hostBytes(type: MbType, payload: ArrayLike<number>): number[] {
  if (type !== MB_READ && type !== MB_WRITE) throw new Error(`host frame type must be 0x11 or 0x12, got 0x${Number(type).toString(16)}`);
  const bytes = Array.from(payload);
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) throw new Error('payload must be byte values 0..255');
  return bytes;
}

function page(type: MbType, bytes: readonly number[], total: number, offset: number): Uint8Array {
  const data = expand(bytes);
  return Uint8Array.from([...HEADER, mbChecksum(data), type, total & 0x7f, total >> 7, offset & 0x7f, offset >> 7, ...data, SYSEX_END]);
}

/** A host message of any length as frames of MB_HOST_PAGE_SIZE bytes, each with the total and its offset. */
export function buildMbFrames(type: MbType, payload: ArrayLike<number>): Uint8Array[] {
  const bytes = hostBytes(type, payload);
  if (bytes.length === 0) throw new Error('an empty message has no frame');
  if (bytes.length <= MB_HOST_PAGE_SIZE) return [buildMbFrame(type, bytes)];
  if (bytes.length >= 1 << 14) throw new Error(`message too long (${bytes.length} bytes; the length field holds 14 bits)`);
  return Array.from({ length: Math.ceil(bytes.length / MB_HOST_PAGE_SIZE) }, (_, i) => {
    const offset = i * MB_HOST_PAGE_SIZE;
    return page(type, bytes.slice(offset, offset + MB_HOST_PAGE_SIZE), bytes.length, offset);
  });
}

/** Parses one complete Matribox SysEx message (F0 … F7). Throws on anything malformed. */
export function parseMbFrame(sysex: Uint8Array): MbFrame {
  if (HEADER.some((b, i) => sysex[i] !== b)) throw new Error('not a Matribox frame: header must be F0 21 25 4D 50 00 00');
  if (sysex[sysex.length - 1] !== SYSEX_END) throw new Error('not a complete SysEx message: must end with F7');
  if (sysex.length < DATA_AT + 1) throw new Error('Matribox frame too short');
  const nibbles = sysex.subarray(DATA_AT, -1);
  if (nibbles.length % 2 !== 0) throw new Error('Matribox payload must have an even number of nibbles');
  const type = sysex[TYPE_AT] as number;
  if (!isType(type)) throw new Error(`unknown Matribox frame type 0x${type.toString(16)}`);
  const at = (i: number) => sysex[TYPE_AT + i] as number;
  const total = join7(at(1), at(2));
  const offset = join7(at(3), at(4));
  const payload = collapse(nibbles);
  if (offset + payload.length > total) throw new Error(`page overruns the message length (${offset}+${payload.length} > ${total})`);
  const checksum = sysex[CK_AT] as number;
  const checksumOk = type === MB_REPLY ? null : mbChecksum(nibbles) === checksum;
  return { type, total, offset, payload, checksum, checksumOk };
}

/**
 * Joins the pages of one paged reply (any order). null while pages are missing; throws when the
 * pages belong to different messages or overlap.
 */
export function joinMbPages(pages: readonly MbFrame[]): Uint8Array | null {
  if (pages.length === 0) return null;
  const total = (pages[0] as MbFrame).total;
  if (pages.some((p) => p.total !== total)) throw new Error('pages of different messages (total lengths differ)');
  const ordered = [...pages].sort((a, b) => a.offset - b.offset);
  const end = ordered.reduce((next, p) => {
    if (p.offset < next) throw new Error(`pages overlap at offset ${p.offset}`);
    return p.offset === next ? next + p.payload.length : Number.NaN;
  }, 0);
  if (end !== total) return null;
  const out = new Uint8Array(total);
  ordered.forEach((p) => out.set(p.payload, p.offset));
  return out;
}

/** Parameter values travel as float32 little-endian. */
export function readFloat32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new RangeError(`float32 at ${offset} is out of range (${bytes.length} bytes)`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(offset, true);
}

export function float32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, true);
  return out;
}
