'use client';

import { type DragEvent, useState, useSyncExternalStore } from 'react';

/** Touch screens (no hover): a draggable tile would take the swipe and the strip could not scroll. */
const TOUCH = '(hover: none)';
const touchOnly = () => window.matchMedia(TOUCH).matches;
const onTouchChange = (notify: () => void) => {
  const query = window.matchMedia(TOUCH);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

/**
 * HTML drag and drop of the chain strip's tiles, shared by both pedals' editors. `tile(id, index)`
 * gives a `li.tile-unit` its props: `id` names what is dragged, `index` is where a drop lands, and
 * `onDrop(id, index)` gets one call per drop. Off on touch screens, where the arrows move tiles.
 */
export function useTileDrag(enabled: boolean, onDrop: (id: number, index: number) => void) {
  const touch = useSyncExternalStore(onTouchChange, touchOnly, () => false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const end = () => {
    setDragging(null);
    setOver(null);
  };
  return (id: number, index: number) => ({
    className: `${dragging === id ? ' tile-dragging' : ''}${over === index && dragging !== null ? ' tile-over' : ''}`,
    draggable: enabled && !touch,
    onDragStart: (e: DragEvent) => {
      setDragging(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(id));
    },
    onDragEnd: end,
    onDragOver: (e: DragEvent) => {
      if (dragging === null) return;
      e.preventDefault();
      setOver(index);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging !== null) onDrop(dragging, index);
      end();
    },
  });
}
