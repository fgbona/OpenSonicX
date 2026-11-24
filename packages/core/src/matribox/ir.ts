/**
 * A WAV as the Matribox II Pro's user IR: the 1024 int24 samples at 44.1 kHz the official tool
 * sends (docs/matribox.md, "User IR upload"). Its native helper reads the WAV's first channel into
 * floats, resamples it with r8brain 1.6 to 44.1 kHz and writes a 24-bit WAV through JUCE, whose
 * samples are then sent: so each sample is round(f * (2^31 - 1)) >> 8, f clipped to [-1, 1].
 *
 * Checked sample for sample against the official upload of a 48 kHz, 24-bit mono IR. 44.1 kHz
 * files skip the resampler (r8brain passes equal rates through). Other rates are refused: the
 * resampler takes other paths there, not ported or checked.
 */
import { parseWav } from '../ir-upload.ts';
import { r8bResample } from './r8b.ts';

export const MB_IR_RATE = 44100;
export const MB_IR_TAPS = 1024;
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

/** The IR samples the official tool would send for `wav` (PCM 8/16/24/32-bit or float32, 44.1 or 48 kHz). */
export function mbIrSamplesFromWav(wav: Uint8Array): Int32Array {
  const { rate, mono } = parseWav(wav, 0);
  if (!SOURCE_RATES.includes(rate as (typeof SOURCE_RATES)[number])) {
    throw new Error(`the Matribox IR upload takes 44.1 or 48 kHz WAVs (this one is ${rate} Hz); convert it first`);
  }
  const floats = mono.map((s) => Math.fround(s));
  const samples = rate === MB_IR_RATE ? floats.slice(0, MB_IR_TAPS) : r8bResample(floats, rate, MB_IR_RATE, MB_IR_TAPS);
  return Int32Array.from({ length: MB_IR_TAPS }, (_, i) => toInt24(samples[i] ?? 0));
}
