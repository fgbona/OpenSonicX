/**
 * User IR upload: a WAV becomes 512 int24 taps at 44.1 kHz, wrapped in a blob that travels in
 * 19-byte chunks over the usual framing. Each chunk is acknowledged (14 08 00) and the pedal
 * announces the flash write with 12 1B 04 (12 1B 01 for presets, seen on the owner's unit).
 *
 * Ported to TypeScript from SonicMaster (github.com/skyggedans/SonicMaster, MIT; ir_upload_frame,
 * sysex_chunk_upload and wav_ir at 931a68f). Clearing a slot (11 23): SonicMaster found it left
 * the pedal refusing further IR writes until a power cycle, but on the owner's V1.3.3 unit the next
 * uploads saved without one (2026-11-22). If it ever happens, upload() reports the missing flash write.
 */
import { buildFrame } from './frame.ts';
import { encodeName } from './slots.ts';

export const IR_RATE = 44100;
export const IR_TAPS = 512;
export const IR_SLOTS = 5;
const INT24_MAX = (1 << 23) - 1;
const CHUNK_BYTES = 19;
const NAME_OFFSET = 10;
const NAME_FIELD = 64;
const SAMPLES_OFFSET = NAME_OFFSET + NAME_FIELD;
const RENAME_NAME_FIELD = 16;
const FLAG = 0x10;
/** Name-field capacity byte; the pedal rejects the real (shorter) length here. */
const NAME_CAPACITY = 0x0a;
const MIN_RATE = 8000;
const MAX_RATE = 192000;

/** Third byte of the 12 1B flash-write notification: what was written. */
export const UploadDomain = { PRESET: 0x01, PROFILE: 0x03, IR: 0x04 } as const;
export type UploadDomain = (typeof UploadDomain)[keyof typeof UploadDomain];

/** Magic of each blob the upload path may carry, per domain. */
const UPLOAD_MAGIC: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  [UploadDomain.IR]: [[0x11, 0x21], [0x11, 0x22], [0x11, 0x23]],
  [UploadDomain.PROFILE]: [[0x11, 0x25], [0x11, 0x26], [0x11, 0x27]],
};

export function isUploadBlob(blob: Uint8Array, domain: UploadDomain): boolean {
  return (UPLOAD_MAGIC[domain] ?? []).some(([a, b]) => blob[0] === a && blob[1] === b);
}

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= IR_SLOTS) throw new Error(`IR slot must be 0..${IR_SLOTS - 1}`);
}

/** Blob that writes `samples` (512 int24) into user IR `slot` (0..4) under `name` (1..10 ASCII). */
export function irUploadBlob(slot: number, name: string, samples: Int32Array): Uint8Array {
  checkSlot(slot);
  const nameBytes = encodeName(name).filter((b) => b !== 0);
  if (samples.length !== IR_TAPS) throw new Error(`an IR has exactly ${IR_TAPS} samples, got ${samples.length}`);
  const blob = new Uint8Array(SAMPLES_OFFSET + IR_TAPS * 4);
  blob.set([0x11, 0x21]);
  blob[6] = slot;
  blob[8] = FLAG;
  blob[9] = NAME_CAPACITY;
  blob.set(nameBytes, NAME_OFFSET);
  const view = new DataView(blob.buffer);
  samples.forEach((s, i) => view.setInt32(SAMPLES_OFFSET + 4 * i, Math.max(-INT24_MAX, Math.min(INT24_MAX, s)), true));
  return blob;
}

/** Blob that renames user IR `slot` without touching its audio. */
export function irRenameBlob(slot: number, name: string): Uint8Array {
  checkSlot(slot);
  const nameBytes = encodeName(name).filter((b) => b !== 0);
  const blob = new Uint8Array(6 + RENAME_NAME_FIELD);
  blob.set([0x11, 0x22, slot, 0x00, FLAG, NAME_CAPACITY]);
  blob.set(nameBytes, 6);
  return blob;
}

/** Blob that empties user IR `slot`: the official tool's fixed 6-byte clear (SonicMaster). */
export function irClearBlob(slot: number): Uint8Array {
  checkSlot(slot);
  return Uint8Array.from([0x11, 0x23, slot, 0x00, FLAG, NAME_CAPACITY]);
}

/** The blob as SysEx chunks: 19 bytes each, numbered 0..n-1 of n. */
export function chunkFrames(blob: Uint8Array): Uint8Array[] {
  const total = Math.ceil(blob.length / CHUNK_BYTES);
  if (total > 255) throw new Error('blob too large for one upload');
  return Array.from({ length: total }, (_, i) => buildFrame([...blob.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)], total, i));
}

/**
 * WAV (PCM 8/16/24/32-bit or float32, any channel count) -> the pedal's IR: mono, 44.1 kHz by
 * linear interpolation (the pedal resamples too, so only rate, length and scale must hold),
 * first 512 taps (silence after a shorter file), int24 full scale, clipped.
 */
export function irSamplesFromWav(bytes: Uint8Array): Int32Array {
  const { rate, mono } = parseWav(bytes);
  const resampled = resampleLinear(mono, rate, IR_RATE);
  return Int32Array.from({ length: IR_TAPS }, (_, i) => {
    const s = resampled[i] ?? 0;
    return Math.max(-INT24_MAX, Math.min(INT24_MAX, Math.round(s * INT24_MAX)));
  });
}

function parseWav(bytes: Uint8Array): { rate: number; mono: number[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let format = 1;
  let channels = 1;
  let rate = IR_RATE;
  let bits = 16;
  let data: { at: number; size: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      data = { at: body, size };
    }
    at = body + size + (size & 1); // chunks are word aligned
  }
  if (!data) throw new Error('the WAV has no audio data');
  if (rate < MIN_RATE || rate > MAX_RATE) throw new Error(`unsupported WAV sample rate ${rate} Hz`);
  if (![8, 16, 24, 32].includes(bits)) throw new Error(`unsupported WAV bit depth ${bits}`);
  if (channels < 1) throw new Error('the WAV has no channels');
  const bytesPer = bits / 8;
  const frameBytes = bytesPer * channels;
  const frames = Math.floor(Math.min(data.size, bytes.length - data.at) / frameBytes);
  const sample = (p: number): number => {
    if (bits === 8) return (view.getUint8(p) - 128) / 128;
    if (bits === 16) return view.getInt16(p, true) / 32768;
    if (bits === 24) {
      const v = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
      return (v & 0x800000 ? v - 0x1000000 : v) / 8388608;
    }
    return format === 3 ? view.getFloat32(p, true) : view.getInt32(p, true) / 2147483648;
  };
  const mono = Array.from({ length: frames }, (_, f) => {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += sample(data!.at + f * frameBytes + c * bytesPer);
    return sum / channels;
  });
  return { rate, mono };
}

function resampleLinear(src: readonly number[], from: number, to: number): readonly number[] {
  if (from === to || src.length === 0) return src;
  const n = Math.round((src.length * to) / from);
  return Array.from({ length: n }, (_, i) => {
    const pos = (i * from) / to;
    const lo = Math.floor(pos);
    const a = src[lo] ?? 0;
    const b = src[lo + 1] ?? 0;
    return a + (b - a) * (pos - lo);
  });
}
