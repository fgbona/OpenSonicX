'use client';

/**
 * Presets exported or imported in this browser (or the desktop app), so they can be loaded or
 * compared again without looking for the file. Kept in localStorage like the backups.
 */
import { useSyncExternalStore } from 'react';
import { parsePresetFile, type PresetFile } from '@pocket-master/core';

const KEY = 'pocket-master-editor.presetLibrary.v1';
export const LIBRARY_LIMIT = 50;

const same = (a: PresetFile, b: PresetFile) => a.payload === b.payload && a.name === b.name;

/** `list` with `file` first; the same sound under the same name is not kept twice. */
export function withPreset(list: readonly PresetFile[], file: PresetFile): PresetFile[] {
  return [file, ...list.filter((f) => !same(f, file))].slice(0, LIBRARY_LIMIT);
}

export function withoutPreset(list: readonly PresetFile[], file: PresetFile): PresetFile[] {
  return list.filter((f) => !(same(f, file) && f.createdAt === file.createdAt));
}

/** The stored library, keeping only entries that are still valid preset files. */
export function parseLibrary(raw: string | null): PresetFile[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      try {
        return [parsePresetFile(JSON.stringify(item))];
      } catch {
        return []; // skip a damaged entry, keep the rest
      }
    });
  } catch {
    return [];
  }
}

let cache: PresetFile[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: PresetFile[] = [];

function current(): PresetFile[] {
  if (cache === null) {
    try {
      cache = parseLibrary(localStorage.getItem(KEY));
    } catch {
      cache = []; // storage blocked: the library lasts for this page only
    }
  }
  return cache;
}

function update(next: PresetFile[]): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked or full: kept for this page only
  }
  listeners.forEach((listener) => listener());
}

export const addToLibrary = (file: PresetFile) => update(withPreset(current(), file));
/** The library as it is now, for code outside React (the tone assistant's tools). */
export const libraryNow = (): readonly PresetFile[] => current();
export const removeFromLibrary = (file: PresetFile) => update(withoutPreset(current(), file));

/** The library, newest first; components re-render when it changes. */
export function usePresetLibrary(): readonly PresetFile[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
    () => EMPTY,
  );
}
