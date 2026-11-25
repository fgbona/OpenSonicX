'use client';

/**
 * Matribox II Pro tones kept in this browser: the edit buffer under a name and a note, to load
 * again (into the edit buffer only, never a slot), rename, delete, or carry to another browser as
 * one JSON file. Its own localStorage key, beside the Pocket Master's preset library.
 */
import { fromHex, mbPresetBody, parseMbPreset, toHex, type MbPreset } from '@pocket-master/core';
import { localList } from './localList.ts';
import { LIBRARY_LIMIT } from './presetLibrary.ts';

const KEY = 'pocket-master-editor.matriboxLibrary.v1';
const DEVICE = 'Sonicake Matribox II Pro';
const FORMAT = 'matribox-library';
export const NOT_MB_LIBRARY = 'not a Matribox tone library file';

export interface MbTone {
  readonly device: typeof DEVICE;
  readonly name: string;
  readonly notes: string;
  readonly createdAt: string;
  /** The preset's 1207-byte body (mbPresetBody), as hex. */
  readonly preset: string;
}

export function mbTone(preset: MbPreset, name: string, notes: string, createdAt = new Date().toISOString()): MbTone {
  return { device: DEVICE, name: name.trim(), notes: notes.trim(), createdAt, preset: toHex(mbPresetBody(preset)) };
}

export const tonePreset = (tone: MbTone): MbPreset => parseMbPreset(fromHex(tone.preset));

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The tone called `name` (any case), or undefined. */
export const findTone = (list: readonly MbTone[], name: string) => list.find((t) => sameName(t.name, name));

/** `list` with `tone` first; a tone of the same name is replaced, as a save replaces a slot. */
export function withTone(list: readonly MbTone[], tone: MbTone): MbTone[] {
  return [tone, ...list.filter((t) => !sameName(t.name, tone.name))].slice(0, LIBRARY_LIMIT);
}

/** Tones are told apart by when they were kept. */
export const withoutTone = (list: readonly MbTone[], createdAt: string): MbTone[] => list.filter((t) => t.createdAt !== createdAt);

/** Renames one tone; another tone already under the new name gives way, so names stay unique. */
export function renamedTone(list: readonly MbTone[], createdAt: string, name: string): MbTone[] {
  const tone = list.find((t) => t.createdAt === createdAt);
  if (!tone || !name.trim()) return [...list];
  return list.filter((t) => t.createdAt === createdAt || !sameName(t.name, name)).map((t) => (t === tone ? { ...t, name: name.trim() } : t));
}

/** One entry if it is a valid tone (its preset parses), else null. */
function asTone(item: unknown): MbTone | null {
  const t = item as Partial<MbTone> | null;
  if (t?.device !== DEVICE || typeof t.name !== 'string' || !t.name.trim() || typeof t.createdAt !== 'string' || typeof t.preset !== 'string') return null;
  try {
    tonePreset(t as MbTone);
  } catch {
    return null;
  }
  return { device: DEVICE, name: t.name, notes: typeof t.notes === 'string' ? t.notes : '', createdAt: t.createdAt, preset: t.preset };
}

/** The stored library, keeping only entries that are still valid tones. */
export function parseMbLibrary(raw: string | null): MbTone[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(list) ? list.map(asTone).filter((t): t is MbTone => t !== null) : [];
  } catch {
    return [];
  }
}

/** The library as a file, for another browser or the desktop app. */
export const mbLibraryFile = (list: readonly MbTone[]) => ({ format: FORMAT, version: 1, tones: list });

/** The tones of an exported library file; a damaged entry is skipped, a file that is not one is refused. */
export function parseMbLibraryFile(text: string): MbTone[] {
  let json: { format?: unknown; tones?: unknown } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON: refused below
  }
  if (json?.format !== FORMAT || !Array.isArray(json.tones)) throw new Error(NOT_MB_LIBRARY);
  return parseMbLibrary(JSON.stringify(json.tones));
}

/** `incoming` added to `list` (oldest first, so the file's newest ends on top); same names are replaced. */
export const mergedTones = (list: readonly MbTone[], incoming: readonly MbTone[]): MbTone[] => [...incoming].reverse().reduce(withTone, [...list]);

const store = localList(KEY, parseMbLibrary);

export const mbLibraryNow = (): readonly MbTone[] => store.now();
export const keepMbTone = (tone: MbTone) => store.set(withTone(store.now(), tone));
export const removeMbTone = (createdAt: string) => store.set(withoutTone(store.now(), createdAt));
export const renameMbTone = (createdAt: string, name: string) => store.set(renamedTone(store.now(), createdAt, name));
export const importMbTones = (tones: readonly MbTone[]) => store.set(mergedTones(store.now(), tones));
/** The library, newest first; components re-render when it changes. */
export const useMbLibrary = (): readonly MbTone[] => store.useList();
