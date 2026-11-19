/** BPM helpers: effective parameter specs under tempo sync, and delay times from a BPM. */
import type { ParamSpec } from './catalog.ts';
import { modelOf, type Block, type Preset } from './dump.ts';
import { effectiveSpec } from './sync.ts';

export { SYNC_DIVISIONS, effectiveSpec } from './sync.ts';

/** Note divisions for setting a delay's Time from the BPM: label and length in quarter notes. */
export const TAP_DIVISIONS = [
  { label: '1/8', multiplier: 0.5 },
  { label: '1/8·', multiplier: 0.75 },
  { label: '1/4', multiplier: 1 },
  { label: '1/2', multiplier: 2 },
] as const;

/** Milliseconds of `multiplier` quarter notes at `bpm`, rounded. */
export function delayMs(bpm: number, multiplier: number): number {
  return Math.round((60000 / bpm) * multiplier);
}

/** The spec of slot `alg` of `block` as the pedal reads it now (tempo sync taken into account). */
export function paramSpecFor(preset: Preset, block: Block, alg: number): ParamSpec | undefined {
  const spec = modelOf(preset, block)?.params.find((p) => p.alg === alg);
  return spec && effectiveSpec(spec, (a) => block.params.find((p) => p.alg === a)?.value);
}
