'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { RigBlock } from '@/lib/rigBlocks';
import { setRigLook } from '@/lib/rigLook';
import { useMenuUnder, useSnakeLine } from '../MatriboxChain';
import { useI18n } from '../I18n';
import { useTileDrag } from '../useTileDrag';
import { RigDetail } from './RigDetail';
import { RigIcon } from './RigIcon';

/** Editing the chain itself (the Matribox): moves by index, removal, and the add slot. */
export interface RigChainEdit {
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** The add slot, shown while the unit has a free slot: the model picker it opens. */
  add?: (isInside: (target: Node) => boolean, onClose: (refocus: boolean) => void) => ReactNode;
}

interface Props {
  blocks: readonly RigBlock[];
  /** The block the strip below edits (its id). */
  selected: number | null;
  /** "17C" / "P09" and the preset's name. */
  label: string;
  name: string;
  /** The preset's BPM, when it has one. */
  tempo: number | null;
  /** Patch volume, 0..100: the OUT box's level. */
  volume: number | null;
  disabled: boolean;
  onSelect: (id: number) => void;
  onOn: (id: number, on: boolean) => void;
  onParam: (id: number, param: number, value: number) => void;
  /** The gear button (the unit's global options), when the header has one. */
  settings?: ReactNode;
  /** Shown under the chain: the Matribox's DSP load. */
  load?: ReactNode;
  /** Every control of the block (the classic panel), shown when the strip is expanded. */
  panel: ReactNode;
  edit?: RigChainEdit;
}

/** The OUT and IN sockets: a label and a level bar (decorative on IN: the units report no input level). */
function Socket({ label, level }: { label: string; level: number }) {
  return (
    <div className="rig-node rig-socket" aria-hidden="true">
      <span>{label}</span>
      <span className="rig-socket-level" style={{ '--level': `${Math.round(level * 100)}%` } as React.CSSProperties} />
    </div>
  );
}

/** Opens the preset list: the sidebar's search, or on a phone the fold that hides it. */
function showPresets() {
  const search = document.querySelector<HTMLElement>('.sidebar-search');
  if (search?.offsetParent) return search.focus();
  document.querySelector<HTMLElement>('.sidebar-toggle')?.click();
}

const STEPS: Record<string, -1 | 1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The "new look" (preview) of either pedal's editor: the preset on a device screen, its chain as
 * gear drawings on a snake from IN to OUT, and the selected block's main controls in a strip below.
 * With `edit` (the Matribox) gear is dragged to reorder (Alt+arrows or the strip's arrows without a
 * mouse), added from the slot before OUT and removed from the strip.
 */
export function RigView({ blocks, selected, label, name, tempo, volume, disabled, onSelect, onOn, onParam, settings, load, panel, edit }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // Design option while the owner chooses: ?rigtag=inside prints the module's name on the drawing instead of under it.
  const [inside, setInside] = useState(false);
  useEffect(() => setInside(new URLSearchParams(window.location.search).get('rigtag') === 'inside'), []);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The gear moved with Alt+arrows: focused again once the chain reads back in its new order.
  const refocus = useRef<number | null>(null);
  const block = blocks.find((b) => b.id === selected) ?? null;
  const index = block ? blocks.indexOf(block) : -1;
  const canEdit = edit !== undefined && !disabled;
  const canAdd = edit?.add !== undefined;
  const line = useSnakeLine([blocks, selected, canAdd], ':scope > li > .rig-block > .rig-icon, :scope > li > .rig-socket, :scope > li > .rig-add');
  useMenuUnder(adding, line.wrap, addRef, menuRef);
  // A drop on the gear's own place writes nothing.
  const drag = useTileDrag(canEdit, (from, to) => {
    if (from !== to) edit?.onMove(from, to);
  });
  const order = blocks.map((b) => b.id).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: order is the chain's identity here
  useEffect(() => {
    if (refocus.current === null) return;
    line.list.current?.querySelector<HTMLButtonElement>(`button[data-id="${refocus.current}"]`)?.focus();
    refocus.current = null;
  }, [order]);

  const move = (at: number, step: -1 | 1) => {
    const to = at + step;
    if (canEdit && to >= 0 && to < blocks.length) edit.onMove(at, to);
  };
  // Arrow keys walk the chain (focus and selection together); Alt+arrows move the focused gear.
  const walk = (e: KeyboardEvent<HTMLOListElement>) => {
    const step = STEPS[e.key];
    const target = e.target as HTMLElement;
    if (!step || !target.matches('button.rig-block')) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button.rig-block'));
    const at = buttons.indexOf(target as HTMLButtonElement);
    e.preventDefault();
    if (e.altKey) {
      refocus.current = Number(target.dataset.id);
      return move(at, step);
    }
    const next = buttons[at + step];
    if (!next) return;
    next.focus();
    onSelect(Number(next.dataset.id));
  };
  const closeAdd = (back: boolean) => {
    setAdding(false);
    if (back) addRef.current?.focus();
  };

  return (
    <section className={`rig${inside ? ' rig-tags-inside' : ''}`} aria-label={t('rig.aria')}>
      <div className="rig-screen">
        <header className="rig-head">
          <button type="button" className="rig-icon-button" aria-label={t('rig.presets')} onClick={showPresets}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M4 5h12M4 10h12M4 15h12" />
            </svg>
          </button>
          <p className="rig-title">
            <span className="rig-label">{label}</span>
            {name && ` - ${name}`}
          </p>
          <span className="rig-head-end">
            {tempo !== null && <span className="rig-bpm">{t('rig.bpm', { bpm: tempo.toFixed(1) })}</span>}
            {settings}
          </span>
        </header>
        <div className="rig-chain" ref={line.wrap}>
          <svg className="rig-wire" aria-hidden="true" focusable="false">
            {line.path && <path d={line.path} />}
          </svg>
          <ol
            ref={line.list}
            className="rig-list"
            aria-label={t('chain.aria')}
            aria-describedby={edit ? 'rig-keys' : undefined}
            // Two rows, as on the units' screens: IN, the blocks, the add slot, OUT.
            style={{ '--cols': Math.ceil((blocks.length + (canAdd ? 3 : 2)) / 2) } as React.CSSProperties}
            onKeyDown={walk}
          >
            <li>
              <Socket label="IN" level={0} />
            </li>
            {blocks.map((b, at) => {
              const isSelected = b.id === block?.id;
              const { className, ...dragProps } = drag(at, at);
              return (
                <li key={b.id} className={className.trim() || undefined} {...dragProps}>
                  <button
                    type="button"
                    className={`rig-node rig-block${isSelected ? ' is-selected' : ''}${b.on ? '' : ' is-off'}`}
                    data-id={b.id}
                    aria-pressed={isSelected}
                    aria-label={t('tile.select', { block: b.name, model: b.model })}
                    onClick={() => onSelect(b.id)}
                  >
                    <RigIcon spec={b.spec} tag={inside ? b.module : undefined} />
                    {!inside && (
                      <span className="rig-tag" aria-hidden="true">
                        {b.module}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {canAdd && (
              <li>
                <button
                  ref={addRef}
                  type="button"
                  className="rig-node rig-add"
                  aria-haspopup="listbox"
                  aria-expanded={adding}
                  aria-label={t('mb.addBlock')}
                  disabled={disabled}
                  onClick={() => setAdding(!adding)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M10 4v12M4 10h12" />
                  </svg>
                </button>
              </li>
            )}
            <li>
              <Socket label="OUT" level={Math.max(0, Math.min(1, (volume ?? 0) / 100))} />
            </li>
          </ol>
          {adding && edit?.add && (
            <div className="picker mb-add-menu" ref={menuRef}>
              {edit.add((target) => (addRef.current?.contains(target) || menuRef.current?.contains(target)) ?? false, closeAdd)}
            </div>
          )}
        </div>
        {edit && (
          <p id="rig-keys" className="rig-hint">
            {t('rig.keys')}
          </p>
        )}
        {load}
        {block && (
          <RigDetail
            key={block.id}
            block={block}
            disabled={disabled}
            expanded={expanded}
            onExpand={() => setExpanded(!expanded)}
            onOn={(on) => onOn(block.id, on)}
            onParam={(id, v) => onParam(block.id, id, v)}
            onMove={edit && ((step) => move(index, step))}
            first={index === 0}
            last={index === blocks.length - 1}
            onRemove={edit && (() => edit.onRemove(index))}
          />
        )}
      </div>
      {expanded && block && <div className="rig-panel">{panel}</div>}
      <button type="button" className="rig-classic" onClick={() => setRigLook(false)}>
        {t('rig.classic')}
      </button>
    </section>
  );
}
