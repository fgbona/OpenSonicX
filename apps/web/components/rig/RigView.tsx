'use client';

import { type KeyboardEvent, type ReactNode, useState } from 'react';
import type { MbResolvedBlock } from '@pocket-master/core';
import { rigCategory, rigIconSpec } from '@/lib/rigIcon';
import { mbTileModel, useSnakeLine } from '../MatriboxChain';
import { useI18n } from '../I18n';
import { RigDetail } from './RigDetail';
import { RigIcon } from './RigIcon';

interface Props {
  chain: readonly MbResolvedBlock[];
  /** The block the strip below edits. */
  block: MbResolvedBlock | null;
  /** "17C" and the preset's name. */
  label: string;
  name: string;
  tempo: number;
  /** Patch volume, 0..100: the OUT box's level. */
  volume: number;
  disabled: boolean;
  userSlot: (block: Pick<MbResolvedBlock, 'module' | 'fxid'>) => string | undefined;
  onSelect: (slot: number) => void;
  onOn: (slot: number, on: boolean) => void;
  onParam: (slot: number, id: number, value: number) => void;
  /** The gear button (the unit's global options). */
  settings: ReactNode;
  /** Every control of the block (the classic panel), shown when the strip is expanded. */
  panel: ReactNode;
}

const specOf = (b: MbResolvedBlock, name: string) => rigIconSpec(rigCategory(b), `${b.moduleIndex}:${b.fxid}`, b.params.length, name);

/** The OUT and IN sockets: a label and a level bar (decorative on IN: the unit reports no input level). */
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
  const search = document.querySelector<HTMLElement>('.mb-sidebar .sidebar-search');
  if (search?.offsetParent) return search.focus();
  document.querySelector<HTMLElement>('.mb-sidebar .sidebar-toggle')?.click();
}

/**
 * A preview of a "rig" look for the Matribox: the preset on a device screen, its chain as gear
 * drawings on a snake from IN to OUT, and the selected block's main controls in a strip below.
 * Opened with ?rig=1 (MatriboxEditor); the classic editor stays the default.
 */
export function RigView({ chain, block, label, name, tempo, volume, disabled, userSlot, onSelect, onOn, onParam, settings, panel }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const line = useSnakeLine([chain, block?.slot], ':scope > li > .rig-node');

  // Arrow keys walk the chain: focus and selection move together.
  const walk = (e: KeyboardEvent<HTMLOListElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button.rig-block'));
    const next = buttons[buttons.indexOf(e.target as HTMLButtonElement) + step];
    if (!next) return;
    e.preventDefault();
    next.focus();
    onSelect(Number(next.dataset.slot));
  };

  return (
    <section className="rig" aria-label={t('rig.aria')}>
      <div className="rig-screen">
        <header className="rig-head">
          <button type="button" className="rig-icon-button" aria-label={t('rig.presets')} onClick={showPresets}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M4 5h12M4 10h12M4 15h12" />
            </svg>
          </button>
          <p className="rig-title">
            <span className="rig-label">{label}</span> - {name}
          </p>
          <span className="rig-head-end">
            <span className="rig-bpm">{t('rig.bpm', { bpm: tempo.toFixed(1) })}</span>
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
            // Two rows, as on the unit's screen: IN, the blocks, OUT.
            style={{ '--cols': Math.ceil((chain.length + 2) / 2) } as React.CSSProperties}
            onKeyDown={walk}
          >
            <li>
              <Socket label="IN" level={0} />
            </li>
            {chain.map((b) => {
              const model = mbTileModel(b, userSlot(b));
              const selected = b.slot === block?.slot;
              return (
                <li key={b.slot}>
                  <button
                    type="button"
                    className={`rig-node rig-block${selected ? ' is-selected' : ''}${b.on ? '' : ' is-off'}`}
                    data-slot={b.slot}
                    aria-pressed={selected}
                    aria-label={t('tile.select', { block: `${b.position}. ${b.module}`, model })}
                    onClick={() => onSelect(b.slot)}
                  >
                    <RigIcon spec={specOf(b, model)} />
                  </button>
                </li>
              );
            })}
            <li>
              <Socket label="OUT" level={Math.max(0, Math.min(1, volume / 100))} />
            </li>
          </ol>
        </div>
        {block && (
          <RigDetail
            key={block.slot}
            block={block}
            model={mbTileModel(block, userSlot(block))}
            disabled={disabled}
            expanded={expanded}
            onExpand={() => setExpanded(!expanded)}
            onOn={(on) => onOn(block.slot, on)}
            onParam={(id, v) => onParam(block.slot, id, v)}
          />
        )}
      </div>
      {expanded && block && <div className="rig-panel">{panel}</div>}
    </section>
  );
}
