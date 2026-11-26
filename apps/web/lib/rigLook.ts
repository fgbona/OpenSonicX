/**
 * The "new look (preview)" choice: the rig view (components/rig) instead of the classic editor,
 * for both pedals. Off by default; turned on in the settings and remembered in this browser.
 * `?rig=1` turns it on for one visit without saving the choice.
 */
import { useSyncExternalStore } from 'react';

export const RIG_LOOK_KEY = 'pocket-master-editor.rigLook';

/** The look a page opens with: the ?rig=1 shortcut, else the saved choice ("1"), else classic. */
export function initialRigLook(search: string, stored: string | null): boolean {
  return new URLSearchParams(search).get('rig') === '1' || stored === '1';
}

let current: boolean | null = null;
const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(RIG_LOOK_KEY);
  } catch {
    return null; // storage blocked: the classic look unless ?rig=1
  }
}

function get(): boolean {
  current ??= initialRigLook(window.location.search, stored());
  return current;
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Switches the look now and saves the choice; without storage it lasts until the page closes. */
export function setRigLook(on: boolean) {
  current = on;
  try {
    localStorage.setItem(RIG_LOOK_KEY, on ? '1' : '0');
  } catch {
    // not remembered across visits; the look still changes now
  }
  for (const notify of listeners) notify();
}

/** Whether the rig view is on. False on the server and the first render, so the exported page is the classic one. */
export function useRigLook(): boolean {
  return useSyncExternalStore(subscribe, get, () => false);
}
