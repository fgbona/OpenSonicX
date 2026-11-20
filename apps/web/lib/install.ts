/** Writing a captured profile (from a .nam) or a cabinet IR (a WAV) into a pedal slot. */
import { irSamplesFromWav, uploadUserIr, uploadUserProfile, type PocketMasterLink } from '@pocket-master/core';
import { convertNam, type ConvertStage } from './convertNam';

import type { SlotKind } from './slotName';

export { NAME_MAX, slotName, type SlotKind } from './slotName';

/** Something to install: its kind, a suggested name and how to get its bytes. */
export interface InstallSource {
  readonly kind: SlotKind;
  readonly label: string;
  readonly name: string;
  /** Comment kept for the slot after a successful install (the TONE3000 tone and its creator). */
  readonly note?: string;
  readonly load: () => Promise<Uint8Array>;
}


export type Exclusive = <T>(step: string, run: (link: PocketMasterLink) => Promise<T>) => Promise<T | null>;

/**
 * Gets the bytes, converts a capture (minutes) or checks a WAV, then writes the slot (0-based).
 * Resolves true when the pedal reported the write; false when the upload failed (shown by the hook).
 */
export async function install(source: InstallSource, slot: number, name: string, exclusive: Exclusive, onStage: (s: ConvertStage | { stage: 'upload' }) => void): Promise<boolean> {
  const bytes = await source.load();
  if (source.kind === 'ir') {
    irSamplesFromWav(bytes); // a bad file fails here, before the pedal is touched
    onStage({ stage: 'upload' });
    return (await exclusive('Uploading', (link) => uploadUserIr(link, slot, name, bytes))) !== null;
  }
  const text = new TextDecoder().decode(bytes);
  const arrays = await convertNam(text, onStage);
  onStage({ stage: 'upload' });
  return (await exclusive('Uploading', (link) => uploadUserProfile(link, slot, name, arrays))) !== null;
}
