'use client';

import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

export interface PickerOption {
  readonly value: string;
  /** The pedal's own name. */
  readonly name: string;
  /** What it is, in plain words; shown in its own column. */
  readonly detail?: string;
  readonly disabled?: boolean;
}

export interface PickerGroup {
  /** Group heading, or null for options without a heading. */
  readonly name: string | null;
  readonly options: readonly PickerOption[];
}

interface Props {
  readonly groups: readonly PickerGroup[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
}

/**
 * The model menu. A native <select> cannot line up a second column, so this is a listbox: the
 * whole list is one grid, and groups and options take its columns (subgrid), so every pedal
 * name and every description starts at the same place. Keyboard: arrows, Home/End, Enter or
 * Space to choose, Escape to close, a letter to jump to the next name starting with it.
 */
export function ModelPicker({ groups, value, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const all = groups.flatMap((g) => g.options);
  const options = all.filter((o) => !o.disabled);
  const current = all.find((o) => o.value === value);
  const optionId = (v: string) => `${id}-${v.replace(/[^a-z0-9]/gi, '_')}`;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const choose = (v: string) => {
    close();
    if (v !== value) onChange(v);
  };
  const show = () => {
    setActive(value);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open && active) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === active);
    const next = options[Math.min(options.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
    if (next) setActive(next.value);
  };

  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => setActive(options[0]?.value ?? null),
      End: () => setActive(options.at(-1)?.value ?? null),
      Enter: () => { if (active) choose(active); },
      ' ': () => { if (active) choose(active); },
      Escape: () => close(),
    };
    if (e.key === 'Tab') return close(false);
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      return action();
    }
    if (e.key.length === 1) {
      const i = options.findIndex((o) => o.value === active);
      const after = [...options.slice(i + 1), ...options.slice(0, i + 1)];
      const hit = after.find((o) => o.name.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) setActive(hit.value);
    }
  };

  return (
    <div className="picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="editor-model picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="picker-name">{current?.name ?? value}</span>
        {current?.detail && <span className="picker-detail">{current.detail}</span>}
      </button>
      {open && (
        <div
          ref={listRef}
          className="picker-list"
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={active ? optionId(active) : undefined}
          onKeyDown={onKey}
        >
          {groups.map((group, gi) => (
            <div key={group.name ?? `group-${gi}`} className="picker-group" role="group" aria-label={group.name ?? undefined}>
              {group.name && <div className="picker-heading" aria-hidden="true">{group.name}</div>}
              {group.options.map((o) => (
                <div
                  key={o.value}
                  id={optionId(o.value)}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  className={`picker-option${o.value === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                  onPointerEnter={() => { if (!o.disabled) setActive(o.value); }}
                  onClick={() => { if (!o.disabled) choose(o.value); }}
                >
                  <span className="picker-check" aria-hidden="true">{o.value === value ? '✓' : ''}</span>
                  <span className="picker-name">{o.name}</span>
                  <span className="picker-detail">{o.detail ?? ''}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
