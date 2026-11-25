/**
 * The Matribox II Pro flows of the editor over a core MatriboxLink: read the unit, read the loaded
 * preset, save to a slot (backup first, then checked by reading the slot back: the unit does not
 * answer a save). The unit answers a preset read with its edit buffer whatever slot it names, so
 * another slot is read only once loaded (core slots.ts). Only the core builders and the official
 * editor's reads are sent; never the unit's own notice messages. Nothing here touches React or the browser.
 */
import {
  checkMbPresetName,
  mbPresetLabel,
  mbReadCloneNames,
  mbReadCurrentPresetNumber,
  mbReadIrNames,
  mbReadPreset,
  mbReadLoadedIndex,
  mbReadPresetNames,
  mbReadSlot,
  mbSavePreset,
  mbStoreSlot,
  parseMbCloneNames,
  parseMbCurrentPresetNumber,
  parseMbIrNames,
  parseMbPreset,
  parseMbPresetNames,
  toHex,
  withMbVolume,
  type MatriboxLink,
  type MbNotice,
  type MbPreset,
  type MbPresetName,
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
  /** "slot": read with the slot loaded, what it stores; "edit-buffer": the loaded preset with its unsaved edits. */
  readonly source?: 'slot' | 'edit-buffer';
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

export function backupFromSlot(index: number, data: Uint8Array, createdAt: string, source: MbBackup['source'] = 'slot'): MbBackup {
  return { device: 'Sonicake Matribox II Pro', label: mbPresetLabel(index), index, name: parseMbPreset(data).name, createdAt, source, preset: toHex(data) };
}

const sectionHex = (preset: MbPreset, id: number) => toHex(preset.sections.find((s) => s.id === id)?.body ?? new Uint8Array());

type Keep = (backup: MbBackup) => void | Promise<void>;

/** Sends a save of the loaded slot `index` (unanswered) and checks it by reading the slot back (name, chain, values). */
async function saveLoaded(link: MatriboxLink, index: number, name: string, loaded: MbPreset, checkMs: number): Promise<void> {
  link.post(mbSavePreset(index, name));
  for (let attempt = 0; attempt < SAVE_CHECKS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, checkMs));
    const listed = parseMbPresetNames(await link.read(mbReadPresetNames()))[index]?.name.trim();
    const stored = parseMbPreset(await link.read(mbReadPreset(index)));
    if (listed === name && [4, 5].every((id) => sectionHex(stored, id) === sectionHex(loaded, id))) return;
  }
  throw new Error(`${mbPresetLabel(index)} does not hold "${name}" after the save: the unit did not store it. The backup of the slot is kept.`);
}

/**
 * Stores the loaded preset (unsaved edits included) in slot `index` under `name`; the slot's backup
 * is handed to `keep` before anything is overwritten. Over the loaded slot: its backup is the
 * edit buffer (reading what it stores would need a select, which drops the edits), then a save.
 * Over another slot: the edit buffer is kept, the slot loaded and backed up, the edit buffer written
 * into it whole, and a save sent only to rename it; that slot stays loaded. If that fails, the
 * edit buffer is handed to `keep` too, so the edits are not lost.
 */
export async function saveToSlot(link: MatriboxLink, index: number, name: string, keep: Keep, now: () => string = () => new Date().toISOString(), checkMs: number = SAVE_CHECK_MS): Promise<MbBackup> {
  checkMbPresetName(name);
  mbSavePreset(index, name); // checks the index before anything is sent
  const current = await mbReadLoadedIndex(link);
  const data = await link.read(mbReadPreset(current));
  const loaded = parseMbPreset(data);
  if (index === current) {
    const backup = backupFromSlot(index, data, now(), 'edit-buffer');
    await keep(backup);
    await saveLoaded(link, index, name, loaded, checkMs);
    return backup;
  }
  try {
    const backup = backupFromSlot(index, await mbReadSlot(link, index), now());
    await keep(backup);
    await mbStoreSlot(link, index, loaded);
    if (name !== loaded.name.trim()) await saveLoaded(link, index, name, loaded, checkMs);
    return backup;
  } catch (error) {
    await keep(backupFromSlot(current, data, now(), 'edit-buffer'));
    throw error;
  }
}

/** The preset with one value of a storage slot changed (a live edit, shown before the unit confirms it). */
export function withParam(preset: MbPreset, slot: number, id: number, value: number): MbPreset {
  return { ...preset, chain: preset.chain.map((b) => (b.slot === slot ? { ...b, values: b.values.map((v, i) => (i === id ? value : v)) } : b)) };
}

export function withBlockOn(preset: MbPreset, slot: number, on: boolean): MbPreset {
  return { ...preset, chain: preset.chain.map((b) => (b.slot === slot ? { ...b, on } : b)) };
}

/** The preset after a change made on the unit itself (a footswitch, a knob); unchanged for the other notices. */
export function withNotice(preset: MbPreset, notice: MbNotice): MbPreset {
  if (notice.kind === 'blockOn') return withBlockOn(preset, notice.slot, notice.on);
  if (notice.kind === 'blocksOn') return { ...preset, chain: preset.chain.map((b) => ({ ...b, on: notice.on[b.slot] ?? b.on })) };
  if (notice.kind === 'param') return withParam(preset, notice.slot, notice.id, notice.value);
  if (notice.kind === 'volume') return withMbVolume(preset, notice.value);
  return preset;
}

/** Runs the calls given to it one at a time, in order; a failure does not stop the next ones. */
export function serialQueue(): <T>(run: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (run) => {
    const call = tail.then(run);
    tail = call.catch(() => undefined);
    return call;
  };
}
