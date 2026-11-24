'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

export interface StripScroll<T extends HTMLElement> {
  readonly ref: RefObject<T | null>;
  /** Blocks hidden before / after the visible part of the strip. */
  readonly hidden: { readonly start: boolean; readonly end: boolean };
  /** Scrolls most of a screen width back (-1) or forward (1). */
  readonly page: (direction: -1 | 1) => void;
}

/**
 * A sideways strip any pointer can scroll: it reports which ends hide content (for ‹ › buttons),
 * and turns the mouse wheel into sideways scrolling while there is room to scroll that way, so the
 * page still scrolls once the strip reaches its end.
 */
export function useStripScroll<T extends HTMLElement>(deps: readonly unknown[]): StripScroll<T> {
  const ref = useRef<T | null>(null);
  const [hidden, setHidden] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setHidden((h) => (h.start === start && h.end === end ? h : { start, end }));
    };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already sideways (trackpad)
      const before = el.scrollLeft;
      el.scrollLeft = before + e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', wheel);
      resize.disconnect();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller passes the list of values that change the strip's content
  }, deps);

  const page = (direction: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  return { ref, hidden, page };
}
