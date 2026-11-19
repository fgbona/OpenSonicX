'use client';

import { useEffect, useId, useRef } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown above the knob, e.g. "400 ms". */
  display: string;
  defaultValue?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** Pixels of vertical drag for the whole range (Shift for fine). */
const DRAG_RANGE = 220;
const SWEEP = 270;
const R = 26;
const C = 32;

const round = (n: number) => Math.round(n * 100) / 100;
const polar = (deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  // Rounded so server and browser render the same path (their trig differs in the last digits).
  return [round(C + R * Math.cos(a)), round(C + R * Math.sin(a))] as const;
};
const arc = (from: number, to: number) => {
  const [x1, y1] = polar(from);
  const [x2, y2] = polar(to);
  return `M${x1} ${y1}A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};

/** A rotary control: drag up/down, wheel, arrow keys; double-click returns to the default. */
export function Knob({ label, value, min, max, step = 1, display, defaultValue, disabled = false, onChange }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const span = max - min || 1;
  const snap = (v: number) => {
    const s = Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step + min;
    return Number(s.toFixed(6));
  };
  const set = (v: number) => {
    const next = snap(v);
    if (next !== latest.current.value) latest.current.onChange(next);
  };

  // A wheel listener must be non-passive to keep the page from scrolling under the knob.
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const steps = Math.max(1, Math.round(span / step / 100));
      set(latest.current.value + (e.deltaY < 0 ? 1 : -1) * step * steps);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const angle = -SWEEP / 2 + ((value - min) / span) * SWEEP;
  const [dx, dy] = polar(angle);
  return (
    <div className={`knob${disabled ? ' is-disabled' : ''}`}>
      <span className="knob-value" aria-hidden="true">{display}</span>
      <div
        ref={ref}
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        aria-disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus();
          drag.current = { y: e.clientY, value };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const range = e.shiftKey ? DRAG_RANGE * 5 : DRAG_RANGE;
          set(d.value + ((d.y - e.clientY) / range) * span);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => { if (!disabled && defaultValue !== undefined) set(defaultValue); }}
        onKeyDown={(e) => {
          if (disabled) return;
          const big = Math.max(step, span / 10);
          const moves: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big };
          if (e.key in moves) set(value + moves[e.key]!);
          else if (e.key === 'Home') set(min);
          else if (e.key === 'End') set(max);
          else return;
          e.preventDefault();
        }}
      >
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <path d={arc(-SWEEP / 2, SWEEP / 2)} className="knob-track" />
          {angle > -SWEEP / 2 + 0.5 && <path d={arc(-SWEEP / 2, angle)} className="knob-arc" />}
          <circle cx={C} cy={C} r="19" className="knob-cap" />
          <line x1={round(C + (dx - C) * 0.42)} y1={round(C + (dy - C) * 0.42)} x2={round(C + (dx - C) * 0.68)} y2={round(C + (dy - C) * 0.68)} className="knob-pointer" />
        </svg>
      </div>
      <span className="knob-label" id={id}>{label}</span>
    </div>
  );
}
