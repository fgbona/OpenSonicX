/**
 * Preset files: one edit buffer as JSON, to keep versions or share a sound.
 * The raw dump is stored, so fields the editor does not decode yet are kept too.
 */
import { applyPreset, requireKnownModels, type Pedal } from './backup.ts';
import { decodePreset, type Preset } from './dump.ts';
import { fromHex, toHex } from './hex.ts';
import { encodeName } from './slots.ts';

export interface PresetFile {
  readonly format: 'pocket-master-preset';
  readonly version: 1;
  readonly name: string;
  readonly createdAt: string;
  /** Raw edit-buffer dump payload (reply to 12 41) in hex. */
  readonly payload: string;
  /** Free text, e.g. which record the tone matches and that it was approved by ear. Optional. */
  readonly notes?: string;
}

export function presetFile(payload: Uint8Array, name: string, now: () => Date = () => new Date(), notes?: string): PresetFile {
  decodePreset(payload); // never write a file the editor cannot read back
  const file = { format: 'pocket-master-preset', version: 1, name, createdAt: now().toISOString(), payload: toHex(payload).replace(/ /g, '') } as const;
  return notes?.trim() ? { ...file, notes: notes.trim() } : file;
}

/** Parses and checks a preset file. Throws a readable error for anything that is not one. */
export function parsePresetFile(text: string): PresetFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a Pocket Master preset file (invalid JSON)');
  }
  const file = data as Partial<PresetFile>;
  const validTime = typeof file?.createdAt === 'string' && !Number.isNaN(Date.parse(file.createdAt));
  if (file?.format !== 'pocket-master-preset' || file.version !== 1 || !validTime) {
    throw new Error('not a Pocket Master preset file');
  }
  try {
    if (typeof file.name !== 'string' || typeof file.payload !== 'string') throw new Error('bad fields');
    if (file.name !== '') encodeName(file.name);
    decodePreset(fromHex(file.payload));
  } catch {
    throw new Error('the preset file is damaged and cannot be read');
  }
  const { format, version, name, createdAt, payload } = file as PresetFile;
  return { format, version, name, createdAt, payload, ...(typeof file.notes === 'string' && file.notes ? { notes: file.notes } : {}) };
}

/**
 * Turns the pedal's edit buffer into `preset` with live-edit commands and checks it took.
 * Nothing is selected and nothing is saved; the user can save it afterwards.
 */
export async function loadIntoEditBuffer(pedal: Pedal, preset: Preset): Promise<Preset> {
  requireKnownModels(preset);
  await applyPreset(pedal, preset);
  return decodePreset(await pedal.readEditBuffer());
}
