'use client';

import { useState } from 'react';
import type { RigBlock, RigParam } from '@/lib/rigBlocks';
import { useI18n } from '../I18n';

/** Parameters a page of the strip shows. */
export const RIG_PAGE = 5;

interface Props {
  block: RigBlock;
  disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  onOn: (on: boolean) => void;
  onParam: (id: number, value: number) => void;
  /** Moves the block one place earlier (-1) or later (+1); absent where the chain cannot move. */
  onMove?: (step: -1 | 1) => void;
  first?: boolean;
  last?: boolean;
  /** Removes the block from the chain; absent where blocks are fixed. */
  onRemove?: () => void;
}

const round = (n: number) => String(Number(n.toFixed(2)));

/** One parameter as a bar: value above, a native range (keyboard and pointer for free), name below. */
function ParamBar({ param, disabled, onChange }: { param: RigParam; disabled: boolean; onChange: (v: number) => void }) {
  const span = param.max - param.min;
  const fill = span > 0 ? ((param.value - param.min) / span) * 100 : 0;
  const option = param.options?.[Math.round((param.value - param.min) / param.step)];
  const shown = param.shown ?? option ?? round(param.value);
  return (
    <label className="rig-param">
      <span className="rig-param-value" aria-hidden="true">
        {shown}
      </span>
      <input
        type="range"
        className="rig-range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={param.value}
        disabled={disabled}
        aria-label={param.name}
        aria-valuetext={shown}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="rig-param-name">{param.name}</span>
    </label>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** The selected block under the chain: its switch, model, move and remove, a way to every control, and its parameters five at a time. */
export function RigDetail({ block, disabled, expanded, onExpand, onOn, onParam, onMove, first, last, onRemove }: Props) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(block.params.length / RIG_PAGE));
  const at = Math.min(page, pages - 1);
  const shown = block.params.slice(at * RIG_PAGE, (at + 1) * RIG_PAGE);
  return (
    <div className="rig-detail">
      <div className="rig-detail-head">
        <button
          type="button"
          role="switch"
          aria-checked={block.on}
          aria-label={t(block.on ? 'block.onAria' : 'block.offAria', { block: block.name })}
          className={`switch rig-switch${block.on ? ' switch-on' : ''}`}
          disabled={disabled}
          onClick={() => onOn(!block.on)}
        >
          <span className="switch-knob" />
        </button>
        {/* The real gear leads (plain attribution); our model name follows, smaller. An original design shows its name only. */}
        <p className="rig-model">
          <span className="rig-module">{block.module}</span> {block.basedOn ? t('editor.basedOn', { gear: block.basedOn }) : block.model}
          {block.basedOn && <span className="rig-model-name">{block.model}</span>}
        </p>
        <span className="rig-detail-tools">
          {onMove && (
            <>
              <button type="button" className="rig-icon-button" disabled={disabled || first} aria-label={t('chain.earlier', { name: block.name })} onClick={() => onMove(-1)}>
                <Icon d="M12 4 6 10l6 6" />
              </button>
              <button type="button" className="rig-icon-button" disabled={disabled || last} aria-label={t('chain.later', { name: block.name })} onClick={() => onMove(1)}>
                <Icon d="m8 4 6 6-6 6" />
              </button>
            </>
          )}
          {onRemove && (
            <button type="button" className="rig-icon-button rig-remove" disabled={disabled} aria-label={t('mb.removeAria', { block: block.name })} onClick={onRemove}>
              <Icon d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
            </button>
          )}
          <button type="button" className="rig-icon-button" aria-expanded={expanded} aria-label={t(expanded ? 'rig.collapse' : 'rig.expand', { block: block.name })} onClick={onExpand}>
            <Icon d={expanded ? 'M8 3v5H3M12 17v-5h5' : 'M3 8V3h5M17 12v5h-5'} />
          </button>
        </span>
      </div>
      {block.params.length === 0 ? (
        <p className="rig-empty">{t('block.noParams')}</p>
      ) : (
        <div className="rig-params" key={at}>
          {shown.map((p) => (
            <ParamBar key={p.id} param={p} disabled={disabled} onChange={(v) => onParam(p.id, v)} />
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="rig-pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" className={`rig-dot${i === at ? ' is-on' : ''}`} aria-current={i === at} aria-label={t('rig.page', { n: i + 1, total: pages })} onClick={() => setPage(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
