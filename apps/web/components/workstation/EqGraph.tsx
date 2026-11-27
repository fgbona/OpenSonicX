'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { MbEqBand, MbGlobalEq } from '@pocket-master/core';
import { EQ_MAX_HZ, EQ_MIN_HZ, type EqSpec, eqBiquads, eqCurve, eqResponseOf } from '@/lib/eqCurve';
import { Knob } from '../Knob';
import { useI18n } from '../I18n';

const W = 600;
const H = 260;
const PAD = { l: 38, r: 14, t: 12, b: 24 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
const DB_MAX = 20;
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const DB_TICKS = [-20, -10, 0, 10, 20];
/** The cut filters' frequencies that mean off (19 Hz low, 20001 Hz high). */
const LOW_CUT_OFF = 19;
const HIGH_CUT_OFF = 20001;

const clampGain = (v: number) => Math.min(DB_MAX, Math.max(-DB_MAX, Math.round(v)));
const xOf = (f: number) => PAD.l + (Math.log(f / EQ_MIN_HZ) / Math.log(EQ_MAX_HZ / EQ_MIN_HZ)) * PLOT_W;
const yOf = (db: number) => PAD.t + ((DB_MAX - Math.max(-DB_MAX, Math.min(DB_MAX, db))) / (2 * DB_MAX)) * PLOT_H;
const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));
const dbText = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The spec the curve is drawn from: a cut that is off (or at its off frequency) is left out. */
function specOf(eq: MbGlobalEq): EqSpec {
  const cut = (b: MbEqBand, offAt: number) => (b.on && b.frequency !== offAt ? { frequency: b.frequency, q: b.q } : null);
  return {
    bands: eq.bands.map((b) => ({ frequency: b.frequency, q: b.q, gain: b.gain, on: b.on })),
    lowCut: cut(eq.lowCut, LOW_CUT_OFF),
    highCut: cut(eq.highCut, HIGH_CUT_OFF),
  };
}

const curvePath = (spec: EqSpec) =>
  eqCurve(spec)
    .map(({ f, db }, i) => `${i ? 'L' : 'M'}${round1(xOf(f))} ${round1(yOf(db))}`)
    .join('');

interface NodeProps {
  label: string;
  gain: number;
  x: number;
  y: number;
  selected: boolean;
  disabled: boolean;
  /** Screen pixels per dB on the graph, read when a drag starts. */
  pxPerDb: () => number;
  onSelect: () => void;
  onGain: (v: number) => void;
}

/** One band's node: drag up/down, wheel, keys; double-click resets to 0 dB. */
function EqNode({ label, gain, x, y, selected, disabled, pxPerDb, onSelect, onGain }: NodeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; gain: number; scale: number } | null>(null);
  const latest = useRef({ gain, onGain });
  latest.current = { gain, onGain };
  const set = (v: number) => {
    const next = clampGain(v);
    if (next !== latest.current.gain) latest.current.onGain(next);
  };

  // A wheel listener must be non-passive to keep the page from scrolling under the node.
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      set(latest.current.gain + (e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div
      ref={ref}
      className={`eq-node${selected ? ' is-selected' : ''}`}
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={-DB_MAX}
      aria-valuemax={DB_MAX}
      aria-valuenow={gain}
      aria-valuetext={dbText(gain)}
      aria-disabled={disabled}
      onFocus={onSelect}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        onSelect();
        drag.current = { y: e.clientY, gain, scale: pxPerDb() };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) set(d.gain + (d.y - e.clientY) / d.scale);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => !disabled && set(0)}
      onKeyDown={(e) => {
        if (disabled) return;
        const moves: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
        if (e.key in moves) set(gain + moves[e.key]!);
        else if (e.key === 'Home') set(-DB_MAX);
        else if (e.key === 'End') set(DB_MAX);
        else return;
        e.preventDefault();
      }}
    />
  );
}

function Grid() {
  return (
    <g className="eq-grid">
      {FREQ_TICKS.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={PAD.t} y2={PAD.t + PLOT_H} />
          <text x={xOf(f)} y={H - 7} textAnchor="middle">
            {freqLabel(f)}
          </text>
        </g>
      ))}
      {DB_TICKS.map((db) => (
        <g key={db} className={db === 0 ? 'eq-zero' : undefined}>
          <line x1={PAD.l} x2={PAD.l + PLOT_W} y1={yOf(db)} y2={yOf(db)} />
          <text x={PAD.l - 6} y={yOf(db) + 4} textAnchor="end">
            {db > 0 ? `+${db}` : db}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Hardware-style value: a label over a readout, no control. */
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="eq-readout">
      <span className="eq-readout-value">{value}</span>
      <span className="eq-readout-label">{label}</span>
    </div>
  );
}

interface Props {
  eq: MbGlobalEq;
  eqOn: boolean;
  disabled: boolean;
  onOn: (on: boolean) => void;
  onLevel: (v: number) => void;
  onGain: (band: number, v: number) => void;
}

/** The global EQ as the unit shows it: the response graph with a node per band, and the controls under it. */
export function EqGraph({ eq, eqOn, disabled, onOn, onLevel, onGain }: Props) {
  const { t } = useI18n();
  const gradient = useId();
  const [selected, setSelected] = useState(0);
  const plot = useRef<HTMLDivElement>(null);
  const spec = specOf(eq);
  const filters = eqBiquads(spec);
  const band = eq.bands[selected] ?? eq.bands[0]!;
  const cutText = (b: MbEqBand, offAt: number) => (b.on && b.frequency !== offAt ? `${Math.round(b.frequency)} Hz` : t('mbGlobal.cutOff'));
  // Screen pixels per dB, so a drag of the node follows the pointer whatever the graph's size.
  const pxPerDb = () => ((plot.current?.getBoundingClientRect().height ?? H) * (PLOT_H / H)) / (2 * DB_MAX);

  return (
    <div className={`eq-panel${eqOn ? '' : ' is-bypassed'}`}>
      <div className="eq-plot" ref={plot}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('eq.graph')} className="eq-svg">
          <defs>
            <clipPath id={gradient}>
              <rect x={PAD.l} y={PAD.t} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>
          <Grid />
          <path d={curvePath(spec)} className="eq-curve" clipPath={`url(#${gradient})`} />
        </svg>
        {eq.bands.map((b, i) => (
          <EqNode
            key={`band${i + 1}`}
            label={t('mbGlobal.band', { n: i + 1, freq: `${Math.round(b.frequency)} Hz` })}
            gain={b.gain}
            x={xOf(b.frequency)}
            y={yOf(eqResponseOf(filters, b.frequency))}
            selected={i === selected}
            disabled={disabled}
            pxPerDb={pxPerDb}
            onSelect={() => setSelected(i)}
            onGain={(v) => onGain(i, v)}
          />
        ))}
      </div>
      <p className="eq-hint">{t('eq.hint')}</p>
      <div className="eq-controls">
        <button type="button" role="switch" aria-checked={eqOn} aria-label={t('mbGlobal.eqOn')} className={`eq-power${eqOn ? ' is-on' : ''}`} disabled={disabled} onClick={() => onOn(!eqOn)}>
          <span className="eq-power-led" aria-hidden="true" />
          <span className="eq-power-text" aria-hidden="true">
            {eqOn ? t('eq.stateOn') : t('eq.stateOff')}
          </span>
        </button>
        <Knob label={t('mbGlobal.eqLevel')} value={eq.level} min={0} max={100} display={String(Math.round(eq.level))} defaultValue={50} disabled={disabled} onChange={onLevel} />
        <Readout label={t('eq.loCut')} value={cutText(eq.lowCut, LOW_CUT_OFF)} />
        <Readout label={t('eq.hiCut')} value={cutText(eq.highCut, HIGH_CUT_OFF)} />
        <Knob
          key={selected}
          label={t('eq.bandGain', { n: selected + 1 })}
          value={band.gain}
          min={-DB_MAX}
          max={DB_MAX}
          display={dbText(band.gain)}
          defaultValue={0}
          disabled={disabled}
          onChange={(v) => onGain(selected, v)}
        />
      </div>
    </div>
  );
}
