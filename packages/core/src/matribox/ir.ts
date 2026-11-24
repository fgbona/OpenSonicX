/**
 * A WAV as the Matribox II Pro's user IR: the 1024 int24 samples at 44.1 kHz the official tool
 * sends (docs/matribox.md, "User IR upload"). Its native helper reads the WAV's first channel into
 * floats, resamples it with r8brain 1.6 to 44.1 kHz and writes a 24-bit WAV through JUCE, whose
 * samples are then sent: so each sample is round(f * (2^31 - 1)) >> 8, f clipped to [-1, 1].
 *
 * Checked sample for sample against the official upload of a 48 kHz, 24-bit mono IR. 44.1 kHz
 * files skip the resampler (r8brain passes equal rates through). Other rates are refused: the
 * resampler takes other paths there, not ported or checked.
 *
 * The upload message (flag 1, cmd 0x14, 4128 bytes): u32 slot, u32 0, u32 checksum, a 20-byte
 * NUL-padded name, the 1024 samples as int32 LE. The checksum is the byte sum of the slot, the zero,
 * the name field and the first 1366 converted samples as int32 LE: the official tool converts more
 * than it sends (1366 = ceil(1024 * 4 / 3) is a guess at why). Checked on three captured uploads:
 * a real 48 kHz IR (the only one where 1366 is the one count that fits), a silence and an impulse.
 */
import { buildMbFrames, MB_WRITE } from './frame.ts';
import { MB_IR_SLOTS, wrapMbMessage } from './message.ts';
import { parseWav } from '../ir-upload.ts';
import { r8bResample } from './r8b.ts';

export const MB_IR_RATE = 44100;
export const MB_IR_TAPS = 1024;
/** Converted samples the upload's checksum covers. */
export const MB_IR_CHECKSUM_SAMPLES = 1366;
const NAME_FIELD = 20;
const NAME_MAX = 16;
const IR_CMD = 0x14;
const SOURCE_RATES = [44100, 48000] as const;
const INT32_MAX = 2147483647;

/** JUCE's roundToInt: to nearest, ties to even. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** One float sample as JUCE's 24-bit WAV writer stores it. */
function toInt24(v: number): number {
  const f = Math.fround(v);
  const i32 = f <= -1 ? -INT32_MAX - 1 : f >= 1 ? INT32_MAX : roundHalfEven(INT32_MAX * f);
  return i32 >> 8;
}

/**
 * The first `count` IR samples the official tool makes of `wav` (PCM 8/16/24/32-bit or float32,
 * 44.1 or 48 kHz); it sends 1024. Silence past the end.
 */
export function mbIrSamplesFromWav(wav: Uint8Array, count: number = MB_IR_TAPS): Int32Array {
  const { rate, mono } = parseWav(wav, 0);
  if (!SOURCE_RATES.includes(rate as (typeof SOURCE_RATES)[number])) {
    throw new Error(`the Matribox IR upload takes 44.1 or 48 kHz WAVs (this one is ${rate} Hz); convert it first`);
  }
  const floats = mono.map((s) => Math.fround(s));
  const samples = rate === MB_IR_RATE ? floats.slice(0, count) : r8bResample(floats, rate, MB_IR_RATE, count);
  return Int32Array.from({ length: count }, (_, i) => toInt24(samples[i] ?? 0));
}

/** Printable ASCII, 1..16 characters: what the IR name table shows. */
export function checkMbIrName(name: string): string {
  if (!/^[\x20-\x7e]{1,16}$/.test(name) || name.trim() === '') throw new RangeError(`IR name must be 1..${NAME_MAX} printable ASCII characters, got "${name}"`);
  return name;
}

const byteSum = (bytes: Uint8Array) => bytes.reduce((sum, b) => sum + b, 0);
const int32Bytes = (values: Int32Array) => new Uint8Array(Int32Array.from(values).buffer); // little-endian hosts only, like Node and browsers

/** The decompressed data of the upload of `wav` into user IR `slot` (0-based, 0..19) under `name`. */
export function mbIrUploadData(slot: number, name: string, wav: Uint8Array): Uint8Array {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MB_IR_SLOTS) throw new RangeError(`IR slot must be 0..${MB_IR_SLOTS - 1}, got ${slot}`);
  const nameField = new Uint8Array(NAME_FIELD);
  nameField.set(Array.from(checkMbIrName(name), (c) => c.charCodeAt(0)));
  const samples = mbIrSamplesFromWav(wav, MB_IR_CHECKSUM_SAMPLES);
  const data = new Uint8Array(32 + MB_IR_TAPS * 4);
  const view = new DataView(data.buffer);
  view.setUint32(0, slot, true);
  data.set(nameField, 12);
  data.set(int32Bytes(samples.subarray(0, MB_IR_TAPS)), 32);
  view.setUint32(8, byteSum(data.subarray(0, 8)) + byteSum(nameField) + byteSum(int32Bytes(samples)), true);
  return data;
}

/** The frames of the upload (literal LZO1X, 183-byte pages); the unit answers flag 3, cmd 0x14, `slot, 1, 0`. */
export function mbIrUpload(slot: number, name: string, wav: Uint8Array): Uint8Array[] {
  return buildMbFrames(MB_WRITE, wrapMbMessage(1, IR_CMD, mbIrUploadData(slot, name, wav)));
}
