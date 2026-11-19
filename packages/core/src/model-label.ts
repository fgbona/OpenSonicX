import { userIrSlot } from './slots.ts';

/** A model name for the screen: user IR slots show the name the owner gave the IR file. */
export function modelLabel(blockKey: string, code: number, catalogName: string, irNames: readonly (string | null)[] | null): string {
  if (blockKey !== 'ir') return catalogName;
  const slot = userIrSlot(code);
  const name = slot === null ? null : irNames?.[slot];
  return name ? `${name} (${catalogName})` : catalogName;
}

const LOW_24_BITS = 0xffffff;
const CAPTURED_PROFILE_BASE = 0x07000000;

/** The model name shown for a block: user IR file names, and the captured profile name in clone mode. */
export function blockModelLabel(
  block: { key: string; code: number; model: string },
  ampMode: 'normal' | 'clone',
  irNames: readonly (string | null)[] | null,
  profileNames: readonly (string | null)[] | null,
): string {
  if (block.key === 'amp' && ampMode === 'clone') {
    const slot = (block.code & LOW_24_BITS) - (CAPTURED_PROFILE_BASE & LOW_24_BITS);
    return profileNames?.[slot] ?? block.model;
  }
  return modelLabel(block.key, block.code, block.model, irNames);
}
