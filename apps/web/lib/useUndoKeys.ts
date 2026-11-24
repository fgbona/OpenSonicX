'use client';

import { useEffect } from 'react';

/** Text fields, pickers and open dialogs keep their own undo; sliders and switches do not have one. */
const OWN_UNDO = 'input:not([type="range"]):not([type="checkbox"]), textarea, select, [contenteditable="true"], dialog[open]';

/** ⌘Z / Ctrl+Z undoes a live edit, ⇧⌘Z / Ctrl+Y redoes, while `enabled`. */
export function useUndoKeys(undo: () => unknown, redo: () => unknown, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(OWN_UNDO)) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) void redo();
      else void undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, enabled]);
}
