/**
 * Pocket Master SysEx framing (see docs/PROTOCOL.md of voronkovd/pocket-master-mcp).
 *
 * Between F0 and F7 every logical byte 0xAB travels as two bytes 0x0A 0x0B.
 * Logical frame: crc, total, index, length, payload[length].
 * crc is CRC-8/SMBus over total..payload.
 */

export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
const MAX_PAYLOAD = 255;
const HEADER_LEN = 4; // crc, total, index, length

export interface Frame {
  readonly total: number;
  readonly index: number;
  readonly payload: Uint8Array;
  readonly crcOk: boolean;
}

export function crc8(bytes: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] as number;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function expand(bytes: ArrayLike<number>): number[] {
  return Array.from(bytes).flatMap((b) => [(b >> 4) & 0x0f, b & 0x0f]);
}

export function collapse(nibbles: ArrayLike<number>): Uint8Array {
  if (nibbles.length % 2 !== 0) throw new Error('nibble-expanded data must have an even length');
  const out = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = nibbles[2 * i] as number;
    const lo = nibbles[2 * i + 1] as number;
    if (hi > 0x0f || lo > 0x0f) throw new Error('data is not nibble-expanded');
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/** Complete SysEx message (F0 … F7) for one packet. */
export function buildFrame(payload: readonly number[], total = 1, index = 0): Uint8Array {
  if (payload.length > MAX_PAYLOAD) throw new Error(`payload too long for one packet (${payload.length} > ${MAX_PAYLOAD})`);
  const body = [total, index, payload.length, ...payload];
  return Uint8Array.from([SYSEX_START, ...expand([crc8(body), ...body]), SYSEX_END]);
}

/** Parses a complete SysEx message (F0 … F7). A bad checksum is reported, not thrown. */
export function parseFrame(sysex: Uint8Array): Frame {
  if (sysex[0] !== SYSEX_START || sysex[sysex.length - 1] !== SYSEX_END) {
    throw new Error('not a SysEx message: must start with F0 and end with F7');
  }
  const logical = collapse(sysex.subarray(1, -1));
  if (logical.length < HEADER_LEN) throw new Error('frame too short');
  const [crc, total, index, length] = logical as unknown as [number, number, number, number];
  const payload = logical.slice(HEADER_LEN);
  const crcOk = crc8(logical.subarray(1)) === crc && length === payload.length;
  return { total, index, payload, crcOk };
}
