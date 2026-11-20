'use client';

/**
 * Comments on the pedal's captured-profile and user IR slots. The pedal stores only a slot's name,
 * so comments live in this browser (or the desktop app), keyed by kind, slot and the name the slot
 * held when the comment was written: a different capture in the same slot starts without one.
 */
import { useSyncExternalStore } from 'react';
import type { SlotKind } from './slotName';

const KEY = 'pocket-master-editor.slotNotes.v1';
export const NOTE_MAX = 80;

export type Notes = Readonly<Record<string, string>>;

const keyOf = (kind: SlotKind, slot: number, name: string) => `${kind}:${slot}:${name}`;

/** The comment for a slot holding `name`, if any. */
export function noteFor(notes: Notes, kind: SlotKind, slot: number, name: string | null | undefined): string | undefined {
  return name ? notes[keyOf(kind, slot, name)] : undefined;
}

/** `notes` with the slot's comment set (trimmed, cut to NOTE_MAX) or removed when blank. */
export function withNote(notes: Notes, kind: SlotKind, slot: number, name: string, text: string): Notes {
  const key = keyOf(kind, slot, name);
  const { [key]: _old, ...rest } = notes;
  const clean = text.trim().slice(0, NOTE_MAX);
  return clean ? { ...rest, [key]: clean } : rest;
}

/** Stored comments, keeping only well-formed entries. */
export function parseNotes(raw: string | null): Notes {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, text]) => /^(ir|profile):[0-4]:/.test(key) && typeof text === 'string')
        .map(([key, text]) => [key, (text as string).slice(0, NOTE_MAX)]),
    );
  } catch {
    return {};
  }
}

let cache: Notes | null = null;
const listeners = new Set<() => void>();
const EMPTY: Notes = {};

function current(): Notes {
  if (cache === null) {
    try {
      cache = parseNotes(localStorage.getItem(KEY));
    } catch {
      cache = {}; // storage blocked: comments last for this page only
    }
  }
  return cache;
}

/** Sets or clears a slot's comment and tells every component showing comments. */
export function setSlotNote(kind: SlotKind, slot: number, name: string, text: string): void {
  cache = withNote(current(), kind, slot, name, text);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage blocked: kept for this page only
  }
  listeners.forEach((listener) => listener());
}

/** All slot comments; components re-render when one changes. */
export function useSlotNotes(): Notes {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
    () => EMPTY,
  );
}
