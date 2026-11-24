/**
 * Reading and storing a whole Matribox slot. The unit answers a preset read (flag 0, cmd 0x10,
 * u32 index) with its edit buffer whatever index it names, tagged with that index (owner's unit,
 * 2026-11-24). So, as the official editor does, a slot is read only once it is loaded (selected);
 * selecting discards the loaded preset's unsaved edits.
 */
import { toHex } from '../hex.ts';
import type { MatriboxLink } from './link.ts';
import { mbReadCurrentPresetNumber, mbReadPreset, parseMbCurrentPresetNumber } from './message.ts';
import { mbPresetLabel, parseMbPreset, type MbPreset } from './preset.ts';
import { mbSelectPreset, mbWritePreset } from './write.ts';

/** Sections the unit keeps exactly as written (capture mb-20); 1 and 8 hold bytes the unit rewrites. */
export const MB_KEPT_SECTIONS: readonly number[] = [2, 3, 4, 5, 7, 9];

type Reads = Pick<MatriboxLink, 'read'>;

const sectionHex = (preset: MbPreset, id: number) => toHex(preset.sections.find((s) => s.id === id)?.body ?? new Uint8Array());

/** The index of the loaded preset. */
export async function mbReadLoadedIndex(link: Reads): Promise<number> {
  return parseMbCurrentPresetNumber(await link.read(mbReadCurrentPresetNumber()));
}

/** The loaded preset as the unit plays it (unsaved edits included), 1211 bytes. */
export async function mbReadEditBuffer(link: Reads): Promise<Uint8Array> {
  return link.read(mbReadPreset(await mbReadLoadedIndex(link)));
}

/** Loads slot `index` and returns what it stores (1211 bytes). Unsaved edits of the loaded preset are lost. */
export async function mbReadSlot(link: Pick<MatriboxLink, 'read' | 'write'>, index: number): Promise<Uint8Array> {
  await link.write(mbSelectPreset(index));
  return link.read(mbReadPreset(index));
}

/**
 * Writes `preset` whole into slot `index` (the unit stores the slot the write names) and reads it
 * back: the kept sections must match. Load the slot first (mbReadSlot or mbSelectPreset), as the
 * official editor does: the read-back reads the edit buffer.
 */
export async function mbStoreSlot(link: Pick<MatriboxLink, 'read' | 'writePreset'>, index: number, preset: MbPreset): Promise<MbPreset> {
  await link.writePreset(mbWritePreset(index, preset));
  const stored = parseMbPreset(await link.read(mbReadPreset(index)));
  const differs = MB_KEPT_SECTIONS.filter((id) => sectionHex(stored, id) !== sectionHex(preset, id));
  if (differs.length > 0) throw new Error(`${mbPresetLabel(index)} differs from "${preset.name}" in section ${differs.join(', ')} after the write`);
  return stored;
}
