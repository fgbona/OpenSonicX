/**
 * Undo and redo for live edits: the presets (of either pedal) as they were before each step. Edits to the same
 * control less than a second apart are one step, so a knob drag undoes in one go.
 */
import type { Preset } from '@pocket-master/core';

export type Snapshot = Preset;

interface Step<T> {
  readonly before: T;
  /** What was edited (e.g. "param:3:1"); null never merges with the next edit. */
  readonly key: string | null;
  readonly at: number;
}

export interface History<T = Snapshot> {
  readonly past: readonly Step<T>[];
  readonly future: readonly T[];
}

export const EMPTY_HISTORY: History<never> = { past: [], future: [] };
const MERGE_MS = 1000;
const LIMIT = 100;

/** The history after an edit made on `before`; anything that could have been redone is dropped. */
export function record<T>(history: History<T>, before: T, key: string | null, now: number): History<T> {
  const last = history.past.at(-1);
  if (last && key !== null && last.key === key && now - last.at < MERGE_MS) {
    return { past: [...history.past.slice(0, -1), { ...last, at: now }], future: [] };
  }
  return { past: [...history.past, { before, key, at: now }].slice(-LIMIT), future: [] };
}

/** The preset to go back to from `current`, and the history after it; null when nothing is left. */
export function undo<T>(history: History<T>, current: T): { history: History<T>; target: T } | null {
  const last = history.past.at(-1);
  if (!last) return null;
  return { target: last.before, history: { past: history.past.slice(0, -1), future: [...history.future, current] } };
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; target: T } | null {
  const next = history.future.at(-1);
  if (next === undefined) return null;
  return { target: next, history: { past: [...history.past, { before: current, key: null, at: 0 }], future: history.future.slice(0, -1) } };
}
