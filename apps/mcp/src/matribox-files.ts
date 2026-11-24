/**
 * The Matribox II Pro's files on disk: .prst presets in their own folder
 * (~/.pocket-master-editor/presets/matribox) and the slot backups save_preset writes
 * (~/.pocket-master-editor/backups). Every path the assistant gives is resolved inside its folder.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromHex, mbPresetLabel, MB_PRESET_SIZE, parseMatriboxPrst, parseMbPreset, writeMatriboxPrst, type MbPreset } from '@pocket-master/core';
import { inside } from './session.ts';

export const MATRIBOX_DEVICE = 'Sonicake Matribox II Pro';
const PRST = /\.prst$/i;
const safe = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'preset';

function prstPath(folder: string, file: string): string {
  if (!PRST.test(file)) throw new Error(`a Matribox preset file ends in .prst, got "${file}"`);
  return inside(folder, file);
}

/** Reads a .prst (Sonicake's official editor's, or one exported here) from `folder`. */
export async function readMatriboxPrst(folder: string, file: string): Promise<MbPreset> {
  return parseMatriboxPrst(await readFile(prstPath(folder, file), 'utf8'));
}

/** Writes `preset` as a .prst in `folder` (default name: label, preset name, time); never replaces a file. */
export async function writeMatriboxPrstFile(folder: string, preset: MbPreset, label: string, file?: string): Promise<string> {
  const path = file === undefined ? join(folder, `${label}-${safe(preset.name)}-${Date.now()}.prst`) : prstPath(folder, file);
  await mkdir(join(path, '..'), { recursive: true });
  try {
    await writeFile(path, writeMatriboxPrst(preset), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${path} already exists; choose another file name`);
    throw error;
  }
  return path;
}

export interface MatriboxBackup {
  readonly label: string;
  readonly index: number;
  readonly name: string;
  readonly preset: MbPreset;
}

/** A backup save_preset wrote (`{ device, label, index, name, createdAt, preset: hex }`), checked field by field. */
export async function readMatriboxBackup(folder: string, file: string): Promise<MatriboxBackup> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(inside(folder, file), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${file} is not a Matribox backup (not JSON)`);
    throw error;
  }
  const backup = json as Record<string, unknown>;
  if (typeof json !== 'object' || json === null || backup.device !== MATRIBOX_DEVICE) throw new Error(`${file} is not a Matribox backup (device is not "${MATRIBOX_DEVICE}")`);
  const { label, index, name, preset } = backup;
  if (typeof index !== 'number' || typeof label !== 'string' || typeof name !== 'string' || typeof preset !== 'string') throw new Error(`${file}: a Matribox backup has label, index, name and preset`);
  if (mbPresetLabel(index) !== label) throw new Error(`${file}: label ${label} does not match index ${index}`);
  const bytes = fromHex(preset);
  if (bytes.length !== MB_PRESET_SIZE) throw new Error(`${file}: the preset holds ${bytes.length} bytes, expected ${MB_PRESET_SIZE}`);
  return Object.freeze({ label, index, name, preset: parseMbPreset(bytes) });
}
