'use client';

import { type ReactNode, useRef } from 'react';

interface Props {
  className: string;
  accept: string;
  /** The hidden input's name, for assistive tech and tests ("Choose a … file"). */
  pickLabel: string;
  disabled?: boolean;
  onPick: (input: HTMLInputElement) => void;
  children: ReactNode;
}

/**
 * A button that opens the file picker: Tab reaches it, Enter and Space press it (a `<label>`
 * around a hidden input does neither). The input stays hidden and takes the chosen file.
 */
export function FileButton({ className, accept, pickLabel, disabled, onPick, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input ref={input} type="file" hidden accept={accept} aria-label={pickLabel} disabled={disabled} onChange={(e) => onPick(e.currentTarget)} />
    </>
  );
}
