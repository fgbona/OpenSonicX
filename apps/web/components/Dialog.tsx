'use client';

import { useEffect, useId, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Escape and the backdrop do not close it while work is running. */
  locked?: boolean;
  children: React.ReactNode;
}

/** Native modal <dialog>: focus trap, Escape and backdrop handling come from the browser. */
export function Dialog({ open, title, onClose, locked = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={() => {
        // The browser can close a modal on its own (a second Escape). Keep it open while locked,
        // otherwise tell the parent so its state matches.
        if (locked && ref.current && !ref.current.open) ref.current.showModal();
        else if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        // Only a click on the backdrop closes it, not one on the sheet's own padding.
        const box = ref.current?.getBoundingClientRect();
        const outside = box && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom);
        if (!locked && e.target === ref.current && outside) onClose();
      }}
    >
      <h2 className="sheet-title" id={titleId}>
        {title}
      </h2>
      <div aria-live="polite">{children}</div>
    </dialog>
  );
}
