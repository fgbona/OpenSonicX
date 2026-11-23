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

/*
 * .prst: the preset file Sonicake's own app exports, 515 bytes:
 * 0x00 "Pocket Master" zero padded to 20 bytes, 0x14 one unknown byte (varies, not checked),
 * 0x15 FF x4, 0x19 name in 16 zero-padded ASCII bytes, 0x29 the edit-buffer dump without its leading 12 41.
 */
const PRST_LENGTH = 515;
const PRST_MAGIC = 'Pocket Master';
const PRST_NAME = { start: 0x19, end: 0x29 } as const;

/** Reads a .prst into a normal preset file. A name the pedal cannot store becomes '' (the sound is kept). */
export function parsePrstFile(bytes: Uint8Array, now: () => Date = () => new Date()): PresetFile {
  const magic = String.fromCharCode(...bytes.subarray(0, 20)).replace(/\0+$/, '');
  if (bytes.length !== PRST_LENGTH || magic !== PRST_MAGIC) throw new Error('not a Pocket Master .prst file');
  const payload = Uint8Array.from([0x12, 0x41, ...bytes.subarray(PRST_NAME.end)]);
  try {
    decodePreset(payload);
  } catch {
    throw new Error('the .prst file is damaged and cannot be read');
  }
  return presetFile(payload, prstName(bytes.subarray(PRST_NAME.start, PRST_NAME.end)), now);
}

function prstName(field: Uint8Array): string {
  const [name = ''] = String.fromCharCode(...field).split('\0');
  try {
    encodeName(name);
    return name;
  } catch {
    return '';
  }
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
