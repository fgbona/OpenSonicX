/**
 * The pedal's .clo clone-model container and the profile upload blobs. The pedal plays
 * x -> FIR(arrayA) -> asymmetric saturator -> FIR(arrayB) -> DC-block biquad.
 * Ported from SonicMaster (github.com/skyggedans/SonicMaster, MIT; clo_codec, clo_upload_frame,
 * crc16_modbus and clo_generator at 931a68f).
 *
 * Layout (little endian unless noted): 0 'VTSI', 4 u32 size, 8 u16 CRC-16/MODBUS of [12, end)
 * big endian, 20 u32 body length, 24 f64 1.0, 64 5 x f64 biquad, 104 4 x f32 gains,
 * 124 u32 128, 128 u32 128, 132 u32 arrayB taps, 136 128 x f32 arrayA, 648 arrayB taps x f32.
 */
import type { CloArrays } from './generate.ts';

export const CLO_FILE_SIZE = 8840;
export const CLO_UPLOAD_SIZE = 2696;
const MAGIC = 0x49535456; // 'VTSI'
const HEADER = 136;
const ARRAY_A = 128;
const ARRAY_B = 2048;
/**
 * The Pocket Master runs only the first 512 taps of arrayB, so its profile upload carries just
 * those. (The Matribox II Pro plays 1024 of the 2048 a .clo stores and takes the whole file.)
 */
export const UPLOAD_ARRAY_B_TAPS = 512;
const BIQUAD_AT = 64;
const GAINS_AT = 104;
const ARRAY_A_AT = 136;
const ARRAY_B_AT = 648;
/** The DC-block high-pass a .clo carries (b0, b1, b2, a1, a2): 40 Hz Butterworth at 48 kHz. */
export const CLO_BIQUAD = [0.9963043928146362, -1.9926087856292725, 0.9963043928146362, -1.9925950765609741, 0.9926224946975708] as const;

export const PROFILE_SLOTS = 5;
export const PROFILE_NAME_LENGTH = 15;
const NAME_AT = 10;
const DATA_AT = NAME_AT + 64;
const PROFILE_NAME_CAPACITY = 0x0f;

export function crc16Modbus(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** Encodes the arrays as a .clo: 2048 arrayB taps for a file, 512 for an upload. */
export function encodeClo(arrays: CloArrays, arrayBTaps: number = ARRAY_B): Uint8Array {
  const size = ARRAY_B_AT + arrayBTaps * 4;
  const buf = new Uint8Array(size);
  const v = new DataView(buf.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, size, true);
  v.setUint32(20, size - HEADER, true);
  v.setFloat64(24, 1, true);
  (arrays.biquad ?? CLO_BIQUAD).forEach((c, i) => v.setFloat64(BIQUAD_AT + 8 * i, c, true));
  arrays.gains.forEach((g, i) => v.setFloat32(GAINS_AT + 4 * i, g, true));
  v.setUint32(124, ARRAY_A, true);
  v.setUint32(128, ARRAY_A, true);
  v.setUint32(132, arrayBTaps, true);
  for (let i = 0; i < ARRAY_A; i++) v.setFloat32(ARRAY_A_AT + 4 * i, arrays.arrayA[i] ?? 0, true);
  for (let i = 0; i < arrayBTaps; i++) v.setFloat32(ARRAY_B_AT + 4 * i, arrays.arrayB[i] ?? 0, true);
  v.setUint16(8, crc16Modbus(buf.subarray(12)), false);
  return buf;
}

export interface CloProfile extends CloArrays {
  readonly biquad: readonly number[];
}

/** Decodes a .clo file; throws on a wrong size, magic or CRC. */
export function decodeClo(bytes: Uint8Array): CloProfile {
  if (bytes.length !== CLO_FILE_SIZE) throw new Error(`a .clo file has ${CLO_FILE_SIZE} bytes, got ${bytes.length}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== MAGIC) throw new Error('not a .clo file (bad magic)');
  const stored = v.getUint16(8, false);
  const crc = crc16Modbus(bytes.subarray(12));
  if (stored !== crc) throw new Error(`.clo CRC mismatch (stored ${stored}, computed ${crc})`);
  const f32 = (at: number, n: number) => Float32Array.from({ length: n }, (_, i) => v.getFloat32(at + 4 * i, true));
  const g = f32(GAINS_AT, 4);
  return {
    biquad: Array.from({ length: 5 }, (_, i) => v.getFloat64(BIQUAD_AT + 8 * i, true)),
    gains: [g[0]!, g[1]!, g[2]!, g[3]!],
    arrayA: f32(ARRAY_A_AT, ARRAY_A),
    arrayB: f32(ARRAY_B_AT, ARRAY_B),
  };
}

function profileName(name: string): number[] {
  if (name.length < 1 || name.length > PROFILE_NAME_LENGTH) throw new Error(`profile names are 1..${PROFILE_NAME_LENGTH} characters`);
  const codes = Array.from(name, (c) => c.charCodeAt(0));
  if (codes.some((c) => c < 0x20 || c > 0x7e)) throw new Error('profile names must be plain ASCII');
  return codes;
}

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PROFILE_SLOTS) throw new Error(`profile slot must be 0..${PROFILE_SLOTS - 1}`);
}

/** Blob that writes a captured profile into slot 0..4: 11 25, slot, 0x0F, name, upload .clo. */
export function profileUploadBlob(slot: number, name: string, arrays: CloArrays): Uint8Array {
  checkSlot(slot);
  const nameBytes = profileName(name);
  const clo = encodeClo(arrays, UPLOAD_ARRAY_B_TAPS);
  const blob = new Uint8Array(DATA_AT + clo.length);
  blob.set([0x11, 0x25]);
  blob[6] = slot;
  blob[9] = PROFILE_NAME_CAPACITY;
  blob.set(nameBytes, NAME_AT);
  blob.set(clo, DATA_AT);
  return blob;
}

/** Blob that empties profile slot 0..4: the official tool's fixed 6-byte clear (SonicMaster). */
export function profileClearBlob(slot: number): Uint8Array {
  checkSlot(slot);
  return Uint8Array.from([0x11, 0x27, slot, 0, 0, PROFILE_NAME_CAPACITY]);
}

/** Blob that renames profile slot 0..4 without touching the model. */
export function profileRenameBlob(slot: number, name: string): Uint8Array {
  checkSlot(slot);
  const blob = new Uint8Array(6 + 16);
  blob.set([0x11, 0x26, slot, 0, 0, PROFILE_NAME_CAPACITY]);
  blob.set(profileName(name), 6);
  return blob;
}
