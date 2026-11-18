import { userIrSlot } from '@pocket-master/core';

/** A model name for the screen: user IR slots show the name the owner gave the IR file. */
export function modelLabel(blockKey: string, code: number, catalogName: string, irNames: readonly (string | null)[] | null): string {
  if (blockKey !== 'ir') return catalogName;
  const slot = userIrSlot(code);
  const name = slot === null ? null : irNames?.[slot];
  return name ? `${name} (${catalogName})` : catalogName;
}
