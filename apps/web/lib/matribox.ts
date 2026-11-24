/**
 * The Matribox II Pro flows of the editor over a core MatriboxLink: read the unit, read the loaded
 * preset, save to a slot (backup first, then checked by reading the slot back: the unit does not
 * answer a save). Only the core builders and the official editor's reads are sent; never the unit's
 * own notice messages. Nothing here touches React or the browser.
 */
import {
  checkMbPresetName, mbPresetLabel, mbReadCloneNames, mbReadCurrentPresetNumber, mbReadIrNames, mbReadPreset, mbReadPresetNames, mbSavePreset,
  parseMbCloneNames, parseMbCurrentPresetNumber, parseMbIrNames, parseMbPreset, parseMbPresetNames, toHex,
  type MatriboxLink, type MbModel, type MbPreset, type MbPresetName,
} from '@pocket-master/core';

export interface MbLoaded {
  readonly current: number;
  readonly preset: MbPreset;
}

export interface MbUnit extends MbLoaded {
  readonly names: readonly MbPresetName[];
  readonly irNames: readonly string[];
  readonly cloneNames: readonly string[];
}

/** A slot as it was before a save overwrote it: the MCP server's backup format. */
export interface MbBackup {
  readonly device: 'Sonicake Matribox II Pro';
  readonly label: string;
  readonly index: number;
  readonly name: string;
  readonly createdAt: string;
  /** The 1211 bytes the unit sent, as hex. */
  readonly preset: string;
}

/** Reads of the slot after a save before giving up, and the pause between them. */
const SAVE_CHECKS = 3;
const SAVE_CHECK_MS = 300;

export async function readLoaded(link: MatriboxLink): Promise<MbLoaded> {
  const current = parseMbCurrentPresetNumber(await link.read(mbReadCurrentPresetNumber()));
  return { current, preset: parseMbPreset(await link.read(mbReadPreset(current))) };
}

export async function readUnit(link: MatriboxLink): Promise<MbUnit> {
  const names = parseMbPresetNames(await link.read(mbReadPresetNames()));
  const loaded = await readLoaded(link);
  const irNames = parseMbIrNames(await link.read(mbReadIrNames()));
  const cloneNames = parseMbCloneNames(await link.read(mbReadCloneNames()));
  return { ...loaded, names, irNames, cloneNames };
}

export function backupFromSlot(index: number, data: Uint8Array, createdAt: string): MbBackup {
  return { device: 'Sonicake Matribox II Pro', label: mbPresetLabel(index), index, name: parseMbPreset(data).name, createdAt, preset: toHex(data) };
}

const sectionHex = (preset: MbPreset, id: number) => toHex(preset.sections.find((s) => s.id === id)?.body ?? new Uint8Array());

/**
 * Stores the loaded preset in slot `index` under `name`. The slot is read and handed to `keep`
 * before the save is sent; the save is then checked by reading the slot back (name, chain, values).
 */
export async function saveToSlot(
  link: MatriboxLink, index: number, name: string, keep: (backup: MbBackup) => void | Promise<void>,
  now: () => string = () => new Date().toISOString(), checkMs: number = SAVE_CHECK_MS,
): Promise<MbBackup> {
  checkMbPresetName(name);
  const save = mbSavePreset(index, name); // checks the index before anything is sent
  const loaded = (await readLoaded(link)).preset;
  const backup = backupFromSlot(index, await link.read(mbReadPreset(index)), now());
  await keep(backup);
  link.post(save);
  for (let attempt = 0; attempt < SAVE_CHECKS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, checkMs));
    const listed = parseMbPresetNames(await link.read(mbReadPresetNames()))[index]?.name.trim();
    const stored = parseMbPreset(await link.read(mbReadPreset(index)));
    if (listed === name && [4, 5].every((id) => sectionHex(stored, id) === sectionHex(loaded, id))) return backup;
  }
  throw new Error(`${mbPresetLabel(index)} does not hold "${name}" after the save: the unit did not store it. The backup of the slot is kept.`);
}

/** The preset with one value of a storage slot changed (a live edit, shown before the unit confirms it). */
export function withParam(preset: MbPreset, slot: number, id: number, value: number): MbPreset {
  return { ...preset, chain: preset.chain.map((b) => (b.slot === slot ? { ...b, values: b.values.map((v, i) => (i === id ? value : v)) } : b)) };
}

export function withBlockOn(preset: MbPreset, slot: number, on: boolean): MbPreset {
  return { ...preset, chain: preset.chain.map((b) => (b.slot === slot ? { ...b, on } : b)) };
}

/** The real gear a model is based on, on one line; '' when the catalog gives none or only a number. */
export const gearOf = (model: MbModel): string => (/[a-z]/i.test(model.origin) ? model.origin.replace(/\s+/g, ' ').trim() : '');

/** Runs the calls given to it one at a time, in order; a failure does not stop the next ones. */
export function serialQueue(): <T>(run: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (run) => {
    const call = tail.then(run);
    tail = call.catch(() => undefined);
    return call;
  };
}
