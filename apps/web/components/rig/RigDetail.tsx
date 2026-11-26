'use client';

import { useState } from 'react';
import type { MbResolvedBlock, MbResolvedParam } from '@pocket-master/core';
import { mbSteps } from '@/lib/matriboxLook';
import { useI18n } from '../I18n';

/** Parameters a page of the strip shows. */
export const RIG_PAGE = 5;

interface Props {
  block: MbResolvedBlock;
  /** The name the chain shows for the block's model. */
  model: string;
  disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  onOn: (on: boolean) => void;
  onParam: (id: number, value: number) => void;
}

const round = (n: number) => String(Number(n.toFixed(2)));

/** One parameter as a bar: value above, a native range (keyboard and pointer for free), name below. */
function ParamBar({ param, step, options, disabled, onChange }: { param: MbResolvedParam; step: number; options?: readonly string[]; disabled: boolean; onChange: (v: number) => void }) {
  const value = Number.isFinite(param.value) ? param.value : param.min;
  const span = param.max - param.min;
  const fill = span > 0 ? ((value - param.min) / span) * 100 : 0;
  const shown = options?.[mbSteps({ min: param.min, max: param.max, step }).indexOf(value)] ?? round(value);
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
        step={step}
        value={value}
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

/** The selected block under the chain: its switch, model, a way to every control, and its parameters five at a time. */
export function RigDetail({ block, model, disabled, expanded, onExpand, onOn, onParam }: Props) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const name = `${block.position}. ${block.module}`;
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
          aria-label={t(block.on ? 'block.onAria' : 'block.offAria', { block: name })}
          className={`switch rig-switch${block.on ? ' switch-on' : ''}`}
          disabled={disabled}
          onClick={() => onOn(!block.on)}
        >
          <span className="switch-knob" />
        </button>
        <p className="rig-model">
          <span className="rig-module">{block.module}</span> {model}
        </p>
        <button type="button" className="rig-icon-button" aria-expanded={expanded} aria-label={t(expanded ? 'rig.collapse' : 'rig.expand', { block: name })} onClick={onExpand}>
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d={expanded ? 'M8 3v5H3M12 17v-5h5' : 'M3 8V3h5M17 12v5h-5'} />
          </svg>
        </button>
      </div>
      {block.params.length === 0 ? (
        <p className="rig-empty">{t('block.noParams')}</p>
      ) : (
        <div className="rig-params" key={at}>
          {shown.map((p) => {
            const spec = block.model?.params.find((m) => m.id === p.id);
            return <ParamBar key={p.id} param={p} step={spec?.step && spec.step > 0 ? spec.step : 1} options={spec?.options} disabled={disabled} onChange={(v) => onParam(p.id, v)} />;
          })}
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
