/**
 * Tempo sync: with a model's Sync switch on, the pedal reads its Time or Rate slot as a note
 * division (an index into SYNC_DIVISIONS) instead of milliseconds or hertz. From SonicMaster
 * (MIT; module_editor.dart at 931a68f, which confirmed Time 500 -> 4 = "1/4" on a unit).
 */
import type { ParamSpec } from './catalog.ts';

export const SYNC_DIVISIONS = ['1/1', '1/2', '1/2D', '1/2T', '1/4', '1/4D', '1/4T', '1/8', '1/8D', '1/8T', '1/16'] as const;

/** The spec a slot really has now: a division select when its Sync switch (`valueOf`) is on. */
export function effectiveSpec(spec: ParamSpec, valueOf: (alg: number) => number | undefined): ParamSpec {
  if (spec.syncedBy === undefined || (valueOf(spec.syncedBy) ?? 0) < 0.5) return spec;
  return { name: spec.name, alg: spec.alg, type: 'select', options: SYNC_DIVISIONS, default: 4, syncedBy: spec.syncedBy };
}
