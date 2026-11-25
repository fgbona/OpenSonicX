/**
 * One Matribox II Pro preset as a file: the .prst Sonicake's own app exports and opens, and the
 * editor's backup of one slot (JSON). Reading a picked file, naming an export, and storing a
 * preset in a slot the way the official app imports one (docs/matribox.md, "Whole-preset write").
 * Nothing here touches React or the browser.
 */
import { fromHex, MB_PRESET_SIZE, mbReadSlot, mbSelectPreset, mbStoreSlot, parseMatriboxPrst, parseMbPreset, type MatriboxLink, type MbPreset } from '@pocket-master/core';
import { backupFromSlot, type MbBackup } from './matribox.ts';

export const MB_PRESET_FILE_ACCEPT = '.prst,.json,application/json';
export const NOT_MB_PRESET = 'not a Matribox II Pro preset file (.prst)';
export const POCKET_MASTER_PRST = 'this is a Pocket Master .prst file, a different format: the Matribox II Pro cannot load it';
const MATRIBOX_DEVICE = 'Sonicake Matribox II Pro';
/** How a Pocket Master .prst (515 bytes) starts. */
const POCKET_MASTER_MAGIC = 'Pocket Master';

/** "17C Drive AD.prst": the slot label and the preset name, without characters a file name cannot hold. */
export function mbPrstFileName(label: string, name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  return `${label} ${safe || 'preset'}.prst`;
}

/** The editor's (and the MCP server's) backup of one slot: `{ device, preset: hex of 1211 bytes }`. */
function fromBackup(text: string): MbPreset {
  const json = JSON.parse(text) as { device?: unknown; preset?: unknown } | null;
  if (json?.device !== MATRIBOX_DEVICE || typeof json.preset !== 'string') throw new Error(NOT_MB_PRESET);
  const data = fromHex(json.preset);
  if (data.length !== MB_PRESET_SIZE) throw new Error(NOT_MB_PRESET);
  return parseMbPreset(data);
}

/** Reads a picked file: a Matribox .prst or a backup of one slot. Anything else is refused with a message for the person. */
export function parseMbPresetFile(bytes: Uint8Array): MbPreset {
  const text = new TextDecoder().decode(bytes);
  if (text.startsWith(POCKET_MASTER_MAGIC)) throw new Error(POCKET_MASTER_PRST);
  try {
    return text.trimStart().startsWith('{') ? fromBackup(text) : parseMatriboxPrst(text);
  } catch (error) {
    console.error('Matribox: the picked file is not a preset', error);
    throw new Error(NOT_MB_PRESET);
  }
}

/**
 * Stores `preset` in slot `index`, as the official app imports a .prst: the slot is loaded (which
 * drops the loaded preset's unsaved edits) and what it stores handed to `keep`; then the preset is
 * written whole (the unit stores it at once, under the name it carries) and read back. The slot
 * stays loaded. A failure after `keep` leaves the backup with the caller.
 */
export async function importToSlot(
  link: Pick<MatriboxLink, 'read' | 'write' | 'writePreset'>,
  index: number,
  preset: MbPreset,
  keep: (backup: MbBackup) => void | Promise<void>,
  now: () => string = () => new Date().toISOString(),
): Promise<MbBackup> {
  mbSelectPreset(index); // checks the index before anything is sent
  const backup = backupFromSlot(index, await mbReadSlot(link, index), now());
  await keep(backup);
  await mbStoreSlot(link, index, preset);
  return backup;
}
