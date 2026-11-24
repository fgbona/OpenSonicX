/**
 * Back up all 240 Matribox presets to one file, and restore them from it (docs/matribox.md,
 * "Backup all"). Both load slot after slot, so the loaded preset's unsaved edits are lost; both
 * load the preset that was loaded again at the end, also after an error.
 */
import { fromHex, toHex } from '../hex.ts';
import type { MatriboxLink } from './link.ts';
import { MB_PRESET_COUNT, MB_PRESET_SIZE, mbPresetLabel, parseMbPreset } from './preset.ts';
import { mbReadLoadedIndex, mbReadSlot, mbStoreSlot } from './slots.ts';
import { mbSelectPreset } from './write.ts';

export const MB_BACKUP_ALL_FORMAT = 'opensonicx-matribox-backup';
export const MB_DEVICE = 'Sonicake Matribox II Pro';

export interface MbBackupEntry {
  readonly index: number;
  /** 1A..60D, as the unit shows it; must match `index`. */
  readonly label: string;
  readonly name: string;
  /** The 1211 bytes the unit sent for the slot once loaded, hex without spaces. */
  readonly preset: string;
}

export interface MbBackupAll {
  readonly format: typeof MB_BACKUP_ALL_FORMAT;
  readonly version: 1;
  readonly device: typeof MB_DEVICE;
  readonly createdAt: string;
  /** All 240 presets, or a subset; each index at most once. */
  readonly presets: readonly MbBackupEntry[];
}

export interface MbProgress {
  /** Presets done so far; `total` once finished. */
  readonly done: number;
  readonly total: number;
  /** The slot being read or written. */
  readonly label: string;
}

interface Options {
  onProgress?: (p: MbProgress) => void;
  now?: () => Date;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Loads `original` again; after a failure, says so in the error instead of hiding the first one. */
async function backTo(link: Pick<MatriboxLink, 'write'>, original: number, failure: Error | null): Promise<void> {
  try {
    await link.write(mbSelectPreset(original));
  } catch (error) {
    const note = `${mbPresetLabel(original)} could not be loaded again (${reason(error)})`;
    throw new Error(failure ? `${failure.message} ${note}.` : note, { cause: failure ?? error });
  }
  if (failure) throw failure;
}

/** Reads every slot by loading it (the only way the unit shows what a slot stores), then loads the original preset again. */
export async function mbBackupAllPresets(link: Pick<MatriboxLink, 'read' | 'write'>, options: Options = {}): Promise<MbBackupAll> {
  const original = await mbReadLoadedIndex(link);
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const presets: MbBackupEntry[] = [];
  let failure: Error | null = null;
  try {
    for (let index = 0; index < MB_PRESET_COUNT; index++) {
      const label = mbPresetLabel(index);
      options.onProgress?.({ done: index, total: MB_PRESET_COUNT, label });
      const data = await mbReadSlot(link, index);
      presets.push({ index, label, name: parseMbPreset(data).name, preset: toHex(data).replaceAll(' ', '') });
    }
  } catch (error) {
    failure = new Error(`Backup stopped at ${mbPresetLabel(presets.length)}: ${reason(error)}. Nothing was written.`, { cause: error });
  }
  await backTo(link, original, failure);
  options.onProgress?.({ done: MB_PRESET_COUNT, total: MB_PRESET_COUNT, label: mbPresetLabel(original) });
  return { format: MB_BACKUP_ALL_FORMAT, version: 1, device: MB_DEVICE, createdAt, presets };
}

/**
 * Writes each preset of `file` whole into its slot (load it, write it, read it back), in file
 * order; stops at the first failure with the slots already written. Then loads the original preset again.
 */
export async function mbRestoreAllPresets(link: MatriboxLink, file: MbBackupAll, options: Pick<Options, 'onProgress'> = {}): Promise<{ written: readonly string[] }> {
  const original = await mbReadLoadedIndex(link);
  const total = file.presets.length;
  const written: string[] = [];
  let failure: Error | null = null;
  for (const entry of file.presets) {
    options.onProgress?.({ done: written.length, total, label: entry.label });
    try {
      await link.write(mbSelectPreset(entry.index));
      await mbStoreSlot(link, entry.index, parseMbPreset(fromHex(entry.preset)));
      written.push(entry.label);
    } catch (error) {
      const done = written.length > 0 ? `Written before it (${written.length} of ${total}): ${written.join(', ')}.` : 'Nothing was written before it.';
      failure = new Error(`Restore stopped at ${entry.label}: ${reason(error)}. ${done}`, { cause: error });
      break;
    }
  }
  await backTo(link, original, failure);
  options.onProgress?.({ done: total, total, label: mbPresetLabel(original) });
  return { written };
}

const notOne = (why: string) => new Error(`not a Matribox backup-all file (${why})`);

function checkEntry(raw: unknown, seen: Set<number>): MbBackupEntry {
  const e = raw as Partial<MbBackupEntry> | null;
  if (typeof e !== 'object' || e === null || !Number.isInteger(e.index) || (e.index as number) < 0 || (e.index as number) >= MB_PRESET_COUNT) {
    throw new Error(`backup-all file: every preset needs an index 0..${MB_PRESET_COUNT - 1}`);
  }
  const index = e.index as number;
  const label = mbPresetLabel(index);
  if (e.label !== label) throw new Error(`backup-all file: label ${String(e.label)} does not match index ${index} (${label})`);
  if (seen.has(index)) throw new Error(`backup-all file: ${label} appears twice`);
  if (typeof e.name !== 'string' || typeof e.preset !== 'string') throw new Error(`backup-all file: ${label} needs a name and a preset`);
  let bytes: Uint8Array;
  try {
    bytes = fromHex(e.preset);
    if (bytes.length !== MB_PRESET_SIZE) throw new Error(`it holds ${bytes.length} bytes, expected ${MB_PRESET_SIZE} bytes`);
    parseMbPreset(bytes);
  } catch (error) {
    throw new Error(`backup-all file: ${label} is damaged: ${reason(error)}`, { cause: error });
  }
  seen.add(index);
  return Object.freeze({ index, label, name: e.name, preset: e.preset });
}

/** Parses and checks a backup-all file (format, version, device, 1..240 presets, labels, sizes) before anything is sent. */
export function parseMbBackupAll(text: string): MbBackupAll {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw notOne('not JSON');
  }
  const file = json as Partial<MbBackupAll> | null;
  if (typeof file !== 'object' || file === null || file.format !== MB_BACKUP_ALL_FORMAT) throw notOne(`format is not "${MB_BACKUP_ALL_FORMAT}"`);
  if (file.version !== 1) throw new Error(`Matribox backup-all file version ${String(file.version)}: this editor reads version 1`);
  if (file.device !== MB_DEVICE) throw notOne(`device is not "${MB_DEVICE}"`);
  if (typeof file.createdAt !== 'string' || Number.isNaN(Date.parse(file.createdAt))) throw notOne('createdAt is not a date');
  if (!Array.isArray(file.presets) || file.presets.length < 1 || file.presets.length > MB_PRESET_COUNT) throw new Error(`backup-all file: it must hold 1..${MB_PRESET_COUNT} presets`);
  const seen = new Set<number>();
  const presets = Object.freeze(file.presets.map((p) => checkEntry(p, seen)));
  return Object.freeze({ format: MB_BACKUP_ALL_FORMAT, version: 1, device: MB_DEVICE, createdAt: file.createdAt, presets });
}
