'use client';

import { useEffect, useRef, useState } from 'react';
import { BPM_RANGE } from '@pocket-master/core';
import { useI18n } from './I18n';

interface Props {
  bpm: number | null;
  editable: boolean;
  onChange: (bpm: number) => void;
}

/** Taps further apart than this start a new count. */
const TAP_RESET_MS = 2000;
const TAPS_AVERAGED = 4;

const clamp = (v: number) => Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, Math.round(v)));

/** The preset tempo: a number field and a tap button (mean of the last four intervals). */
export function BpmControl({ bpm, editable, onChange }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState(bpm === null ? '' : String(bpm));
  const taps = useRef<number[]>([]);
  useEffect(() => setText(bpm === null ? '' : String(bpm)), [bpm]);
  if (!editable) return <>{bpm ?? '—'}</>;

  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v) || text.trim() === '') return setText(bpm === null ? '' : String(bpm));
    const next = clamp(v);
    setText(String(next));
    if (next !== bpm) onChange(next);
  };

  const tap = () => {
    const now = performance.now();
    const last = taps.current.at(-1);
    taps.current = last !== undefined && now - last < TAP_RESET_MS ? [...taps.current, now].slice(-(TAPS_AVERAGED + 1)) : [now];
    if (taps.current.length < 2) return;
    const span = taps.current.at(-1)! - taps.current[0]!;
    const next = clamp(60000 / (span / (taps.current.length - 1)));
    setText(String(next));
    if (next !== bpm) onChange(next);
  };

  return (
    <span className="bpm">
      <input
        className="bpm-input"
        inputMode="numeric"
        aria-label={t('preset.bpm')}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
      <button type="button" className="btn btn-small" aria-label={t('preset.tapAria')} onClick={tap}>{t('preset.tap')}</button>
    </span>
  );
}
