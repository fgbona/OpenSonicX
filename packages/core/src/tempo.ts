/** Effective parameter specs under tempo sync. */
import type { ParamSpec } from './catalog.ts';
import { modelOf, type Block, type Preset } from './dump.ts';
import { effectiveSpec } from './sync.ts';

export { SYNC_DIVISIONS, effectiveSpec } from './sync.ts';

/** The spec of slot `alg` of `block` as the pedal reads it now (tempo sync taken into account). */
export function paramSpecFor(preset: Preset, block: Block, alg: number): ParamSpec | undefined {
  const spec = modelOf(preset, block)?.params.find((p) => p.alg === alg);
  return spec && effectiveSpec(spec, (a) => block.params.find((p) => p.alg === a)?.value);
}
