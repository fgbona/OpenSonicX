'use client';

/**
 * A list kept in localStorage under one key and shared by every component that shows it: read
 * once, written on every change, kept for this page only when the browser blocks or fills storage.
 * The Pocket Master's preset library and the Matribox's tone library are two of these.
 */
import { useSyncExternalStore } from 'react';

export interface LocalList<T> {
  /** The list as it is now, for code outside React (the tone assistant's tools). */
  now(): readonly T[];
  set(next: readonly T[]): void;
  /** The list; components re-render when it changes. */
  useList(): readonly T[];
}

export function localList<T>(key: string, parse: (raw: string | null) => readonly T[]): LocalList<T> {
  let cache: readonly T[] | null = null;
  const listeners = new Set<() => void>();
  const empty: readonly T[] = [];
  const now = (): readonly T[] => {
    if (cache === null) {
      try {
        cache = parse(localStorage.getItem(key));
      } catch {
        cache = []; // storage blocked: the list lasts for this page only
      }
    }
    return cache;
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    now,
    set(next) {
      cache = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked or full: kept for this page only
      }
      listeners.forEach((listener) => listener());
    },
    useList: () => useSyncExternalStore(subscribe, now, () => empty),
  };
}
