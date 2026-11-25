'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { MoreIcon } from './icons';
import { useI18n } from './I18n';

/**
 * The header's secondary actions. Wide screens show them in the row as they are (the menu box is
 * `display: contents`); a phone folds them under a ⋯ button, a disclosure that closes on a choice,
 * a click outside or Escape. The actions stay mounted either way, so a dialog they own survives.
 */
export function MatriboxMore({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: closes the disclosure on a choice and on Escape; the controls inside are the interactive ones
    <div
      ref={box}
      className={`mb-more${open ? ' is-open' : ''}`}
      onClick={(e) => {
        if (e.target !== toggle.current && !toggle.current?.contains(e.target as Node)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (!open || e.key !== 'Escape') return;
        setOpen(false);
        toggle.current?.focus();
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="btn btn-icon mb-more-toggle"
        aria-label={t('mb.moreActions')}
        title={t('mb.moreActions')}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      <div id={menuId} className="mb-more-menu">
        {children}
      </div>
    </div>
  );
}
