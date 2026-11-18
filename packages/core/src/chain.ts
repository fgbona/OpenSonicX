import { FIXED_GROUP, validateChain } from './commands.ts';

/** The chain as movable units: single blocks, plus DRV-AMP-IR-EQ as one unit. */
export function chainUnits(order: readonly number[]): number[][] {
  validateChain(order);
  return order.reduce<number[][]>((units, m) => {
    if (FIXED_GROUP.includes(m) && m !== FIXED_GROUP[0]) return units; // added with DRV
    return [...units, m === FIXED_GROUP[0] ? [...FIXED_GROUP] : [m]];
  }, []);
}

/** New order with the unit that contains `module` moved to unit position `to` (clamped). */
export function moveInChain(order: readonly number[], module: number, to: number): number[] {
  const units = chainUnits(order);
  const from = units.findIndex((u) => u.includes(module));
  if (from < 0) throw new Error(`module ${module} is not in the chain`);
  const rest = units.filter((_, i) => i !== from);
  const at = Math.max(0, Math.min(rest.length, Math.round(to)));
  return [...rest.slice(0, at), units[from] as number[], ...rest.slice(at)].flat();
}
