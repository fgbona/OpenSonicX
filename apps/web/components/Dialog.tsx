'use client';

import { useEffect, useRef } from 'react';

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
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (!locked && e.target === ref.current) onClose();
      }}
    >
      <h2 className="sheet-title">{title}</h2>
      {children}
    </dialog>
  );
}
