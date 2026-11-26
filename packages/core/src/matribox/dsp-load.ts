/**
 * An ESTIMATE of how much of the Matribox II Pro's DSP a chain takes, so the editor can warn and the
 * tone assistant can refuse a chain before the unit shows "CAUTION! System overloaded" (docs/matribox.md,
 * "DSP load"). The unit reports no load over USB, only the overload once it happens (notice.ts).
 *
 * What is known, from zxmarcos/matribox-studio and zxmarcos/waveod (MIT, © 2026 Marcos Medeiros):
 * - a 64-frame block lasts 1.451 ms at 44.1 kHz; the stock app switches every block off and shows the
 *   warning after three blocks in a row over 1.25 ms. Its own work takes about 165 µs, so the chain gets
 *   about 1 ms: ~600 000 cycles of the 600 MHz Cortex-M7;
 * - measured on the unit: a factory Cab/IR ≈ 190 µs (~114 k cycles), the factory Clone ≈ 125 k cycles,
 *   the 63 stock amps 3.78 M cycles in all (~60 k each on average);
 * - memory, checked when a block is inserted: the Cab/IR engine needs ≈ 70 KB and the Clone ≈ 74 KB of
 *   the 192 KB of fast RAM, so a third CAB/IR/CLONE block is refused (with the same warning).
 * Every other module's cost below is our guess (no stock measurement published), set high on purpose: a
 * 12-block chain like the one that overloaded the owner's unit (2026-11-26) comes out past 100%.
 * Bypassed blocks count in full: a footswitch can switch them on.
 */
import { MB_CATALOG } from './catalog.ts';

/** Cycles per 64-frame block by module index (DYN 0 … VOL 15). */
// ponytail: one cost per module, not per model; replace with per-model numbers once measured on the unit.
const CYCLES: Readonly<Record<number, number>> = {
  0: 25_000, // DYN (guess)
  1: 80_000, // FREQ: pitch shifters (guess)
  2: 25_000, // WAH (guess)
  3: 45_000, // DRV (guess)
  4: 60_000, // AMP: stock average, measured
  5: 114_000, // CAB: measured
  6: 114_000, // IR: the same engine as CAB
  7: 20_000, // EQ (guess)
  8: 45_000, // MOD (guess)
  9: 50_000, // DLY (guess)
  10: 100_000, // RVB (guess)
  11: 125_000, // CLONE: measured
  12: 5_000, // FXLOOP
  13: 5_000, // FXSND
  14: 5_000, // FXRTN
  15: 5_000, // VOL
};
const UNKNOWN_CYCLES = 60_000;
/** Cycles a block leaves the chain before the stock app's overload guard trips. */
export const MB_DSP_BUDGET = 600_000;
/** From this share of the budget on, the editor and the assistant warn. */
export const MB_DSP_HIGH = 85;
/** CAB, IR and CLONE: each needs ~70 KB of the 192 KB of fast RAM. */
const BIG_MEMORY = new Set([5, 6, 11]);
export const MB_BIG_MEMORY_MAX = 2;

export interface MbDspLoad {
  /** Estimated share of the chain's budget, in percent (may pass 100). */
  readonly percent: number;
  /** CAB, IR and CLONE blocks in the chain. */
  readonly bigMemory: number;
  /** 'over': past the budget or the memory; 'high': from MB_DSP_HIGH on. */
  readonly level: 'ok' | 'high' | 'over';
}

const cycles = (moduleIndex: number) => CYCLES[moduleIndex] ?? UNKNOWN_CYCLES;
const share = (moduleIndex: number) => Math.round((cycles(moduleIndex) * 100) / MB_DSP_BUDGET);
const moduleName = (index: number) => MB_CATALOG.modules.find((m) => m.index === index)?.name ?? `module ${index}`;

/** The estimated load of a chain (any list of blocks with their module index). */
export function mbDspLoad(chain: readonly { readonly moduleIndex: number }[]): MbDspLoad {
  const percent = Math.round((chain.reduce((sum, b) => sum + cycles(b.moduleIndex), 0) * 100) / MB_DSP_BUDGET);
  const bigMemory = chain.filter((b) => BIG_MEMORY.has(b.moduleIndex)).length;
  const level = percent > 100 || bigMemory > MB_BIG_MEMORY_MAX ? 'over' : percent >= MB_DSP_HIGH ? 'high' : 'ok';
  return { percent, bigMemory, level };
}

/** The heaviest blocks first, "RVB ~17%", for a message. */
function heaviest(chain: readonly { readonly moduleIndex: number }[]): string {
  return [...new Set(chain.map((b) => b.moduleIndex))]
    .sort((a, b) => cycles(b) - cycles(a))
    .slice(0, 3)
    .map((m) => `${moduleName(m)} ~${share(m)}%`)
    .join(', ');
}

/**
 * The tone assistant's check of a chain edit: throws when `after` is past the budget or the memory and
 * heavier than `before` (an edit that does not add load is never refused); returns a warning line when
 * `after` is near the limit, '' otherwise.
 */
export function mbCheckDspLoad(before: readonly { readonly moduleIndex: number }[], after: readonly { readonly moduleIndex: number }[]): string {
  const was = mbDspLoad(before);
  const load = mbDspLoad(after);
  const estimate = `estimated DSP load ${load.percent}% (an estimate from the block types; the unit reports no load)`;
  if (load.bigMemory > MB_BIG_MEMORY_MAX && load.bigMemory > was.bigMemory) {
    throw new Error(
      `the chain would hold ${load.bigMemory} CAB/IR/CLONE blocks; the Matribox II Pro has memory for ${MB_BIG_MEMORY_MAX} (each needs ~70 KB of its 192 KB fast RAM) and refuses the next one with "System overloaded". Keep at most ${MB_BIG_MEMORY_MAX}: drop a CAB, IR or CLONE.`,
    );
  }
  if (load.percent > 100 && load.percent > was.percent) {
    throw new Error(
      `the chain would be past the unit's DSP: ${estimate}. Past 100% the Matribox II Pro shows "System overloaded" and switches every block off. Drop or swap blocks; the heaviest: ${heaviest(after)}.`,
    );
  }
  return load.level === 'ok' ? '' : `Note: ${estimate}, near the unit's limit; avoid adding more blocks (heaviest: ${heaviest(after)}).`;
}
