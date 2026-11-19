/**
 * .nam -> the pedal's clone-model arrays: run the capture over the reference DI at each probe
 * level, fit the clone engine, resample to 44.1 kHz and round to float32.
 * Ported from SonicMaster (MIT; clo_dsp.dart at 931a68f).
 */
import { ARRAY_A_LEN, ARRAY_B_LEN, FIT_LEVELS, fitWhMultilevel, LOUD_LEVEL, RUN_LEN, SRC_RATE } from './fit.ts';
import { parseNam, type Wavenet } from './nam.ts';
import { resample } from './resample.ts';
import { runWavenet } from './wavenet.ts';

export const DEVICE_RATE = 44100;
/** Every level the capture is run at: the fit levels, then the loud one. */
export const PROBE_LEVELS: readonly number[] = [...FIT_LEVELS, LOUD_LEVEL];

export interface CloArrays {
  /** 128-tap pre-filter (input EQ). */
  readonly arrayA: Float32Array;
  /** 2048-tap post-filter (amp and cabinet). */
  readonly arrayB: Float32Array;
  /** [posmax, negmax, posRate, negRate], float32-rounded. */
  readonly gains: readonly [number, number, number, number];
}

/** The reference DI (float32, 44.1 kHz) at 48 kHz in float64, capped at what the fit reads. */
export function referenceDiAt48(di44100: Float32Array): Float64Array {
  return resample(Float64Array.from(di44100), SRC_RATE, DEVICE_RATE, RUN_LEN);
}

/** One probe pass: the capture's response to the DI scaled by `level`. */
export function probeResponse(model: Wavenet, di48: Float64Array, level: number): Float64Array {
  return runWavenet(Float64Array.from(di48, (v) => v * level), model);
}

/** The fit and final assembly from every probe level's response. */
export function finishClo(di48: Float64Array, responses: ReadonlyMap<number, Float64Array>): CloArrays {
  const { a48, b48, gains } = fitWhMultilevel(di48, responses);
  const firA = resample(a48, DEVICE_RATE, SRC_RATE);
  const firB = resample(b48, DEVICE_RATE, SRC_RATE);
  const arrayA = new Float32Array(ARRAY_A_LEN);
  arrayA.set(firA.subarray(0, ARRAY_A_LEN));
  const arrayB = new Float32Array(ARRAY_B_LEN);
  arrayB.set(firB.subarray(0, ARRAY_B_LEN));
  const f = Math.fround;
  return { arrayA, arrayB, gains: [f(gains.posmax), f(gains.negmax), f(gains.posRate), f(gains.negRate)] };
}

/** Whole conversion in one call; `onLevel` reports progress after each probe pass. */
export function generateClo(namJson: string, di44100: Float32Array, onLevel?: (done: number, total: number) => void): CloArrays {
  const model = parseNam(namJson);
  const di48 = referenceDiAt48(di44100);
  const responses = new Map<number, Float64Array>();
  PROBE_LEVELS.forEach((level, i) => {
    responses.set(level, probeResponse(model, di48, level));
    onLevel?.(i + 1, PROBE_LEVELS.length);
  });
  return finishClo(di48, responses);
}
