'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface PickerOption {
  readonly value: string;
  /** The pedal's own name. */
  readonly name: string;
  /** What it is, in plain words; shown in its own column. */
  readonly detail?: string;
  readonly disabled?: boolean;
  /** A drawing before the name (the Matribox's block types). */
  readonly icon?: ReactNode;
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

interface ListProps {
  readonly groups: readonly PickerGroup[];
  /** The option chosen now; '' when none is. */
  readonly value: string;
  readonly ariaLabel: string;
  readonly onChoose: (value: string) => void;
  /** `refocus`: the keyboard closed it, so focus goes back to what opened it. */
  readonly onClose: (refocus: boolean) => void;
  /** True for what a press must not close the list from: the list itself and what opened it. */
  readonly isInside: (target: Node) => boolean;
}

/**
 * The open menu, mounted while it shows. The whole list is one grid, and groups and options take
 * its columns (subgrid), so every pedal name and every description starts at the same place.
 * Keyboard: arrows, Home/End, Enter or Space to choose, Escape to close, a letter to jump to the
 * next name starting with it.
 */
export function PickerList({ groups, value, ariaLabel, onChoose, onClose, isInside }: ListProps) {
  const [active, setActive] = useState<string | null>(value || null);
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const options = groups.flatMap((g) => g.options).filter((o) => !o.disabled);
  const optionId = (v: string) => `${id}-${v.replace(/[^a-z0-9]/gi, '_')}`;
  const latest = useRef({ onClose, isInside });
  latest.current = { onClose, isInside };

  useEffect(() => {
    listRef.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!latest.current.isInside(e.target as Node)) latest.current.onClose(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  useEffect(() => {
    if (active) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === active);
    const next = options[i < 0 ? 0 : Math.min(options.length - 1, Math.max(0, i + delta))];
    if (next) setActive(next.value);
  };

  const onKey = (e: KeyboardEvent) => {
    // biome-ignore-start lint/correctness/noComponentHookFactories: these are key names (KeyboardEvent.key), not components
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => setActive(options[0]?.value ?? null),
      End: () => setActive(options.at(-1)?.value ?? null),
      Enter: () => {
        if (active) onChoose(active);
      },
      ' ': () => {
        if (active) onChoose(active);
      },
      Escape: () => onClose(true),
    };
    // biome-ignore-end lint/correctness/noComponentHookFactories: these are key names (KeyboardEvent.key), not components
    if (e.key === 'Tab') return onClose(false);
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
    <div ref={listRef} className="picker-list" role="listbox" tabIndex={0} aria-label={ariaLabel} aria-activedescendant={active ? optionId(active) : undefined} onKeyDown={onKey}>
      {groups.map((group, gi) => (
        <div key={group.name ?? `group-${gi}`} className="picker-group" role="group" aria-label={group.name ?? undefined}>
          {group.name && (
            <div className="picker-heading" aria-hidden="true">
              {group.name}
            </div>
          )}
          {group.options.map((o) => (
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox, which points at the option with aria-activedescendant
            // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys (onKeyDown above)
            <div
              key={o.value}
              id={optionId(o.value)}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={`picker-option${o.value === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
              onPointerEnter={() => {
                if (!o.disabled) setActive(o.value);
              }}
              onClick={() => {
                if (!o.disabled) onChoose(o.value);
              }}
            >
              <span className="picker-check" aria-hidden="true">
                {o.value === value ? '✓' : ''}
              </span>
              <span className="picker-name">
                {o.icon}
                {o.name}
              </span>
              <span className="picker-detail">{o.detail ?? ''}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The model menu. A native <select> cannot line up a second column, so this is a button that
 * opens a listbox (PickerList).
 */
export function ModelPicker({ groups, value, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = groups.flatMap((g) => g.options).find((o) => o.value === value);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
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
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="picker-name">{current?.name ?? value}</span>
        {current?.detail && <span className="picker-detail">{current.detail}</span>}
      </button>
      {open && (
        <PickerList
          groups={groups}
          value={value}
          ariaLabel={ariaLabel}
          isInside={(target) => rootRef.current?.contains(target) ?? false}
          onClose={close}
          onChoose={(v) => {
            close();
            if (v !== value) onChange(v);
          }}
        />
      )}
    </div>
  );
}
