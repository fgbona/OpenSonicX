'use client';

import { useRef } from 'react';
import { BPM_RANGE, type Edit, type Preset } from '@pocket-master/core';
import { Knob } from './Knob';
import { useI18n } from './I18n';

/** Taps further apart than this start a new count; the BPM is the mean of the last four intervals. */
const TAP_RESET_MS = 2000;
const TAPS_AVERAGED = 4;

/** Preset volume and BPM as knobs, with tap tempo. */
export function PresetFields({ preset, editable, onEdit }: { preset: Preset; editable: boolean; onEdit: (edit: Edit) => void }) {
  const { t } = useI18n();
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    const last = taps.current.at(-1);
    taps.current = last !== undefined && now - last < TAP_RESET_MS ? [...taps.current, now].slice(-(TAPS_AVERAGED + 1)) : [now];
    if (taps.current.length < 2) return;
    const span = taps.current.at(-1)! - taps.current[0]!;
    const bpm = Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, Math.round(60000 / (span / (taps.current.length - 1)))));
    if (bpm !== preset.bpm) onEdit({ kind: 'bpm', value: bpm });
  };
  return (
    <section className="fields" aria-label={t('fields.aria')}>
      {preset.volume !== null && (
        <Knob label={t('preset.volume')} value={preset.volume} min={0} max={100} display={String(preset.volume)} defaultValue={75}
          disabled={!editable} onChange={(value) => onEdit({ kind: 'volume', value })} />
      )}
      {preset.bpm !== null && (
        <div className="fields-bpm">
          <Knob label={t('preset.bpm')} value={preset.bpm} min={BPM_RANGE.min} max={BPM_RANGE.max} display={String(preset.bpm)} defaultValue={120}
            disabled={!editable} onChange={(value) => onEdit({ kind: 'bpm', value })} />
          <button type="button" className="btn btn-small tap-button" aria-label={t('preset.tapAria')} disabled={!editable} onPointerDown={tap}>{t('preset.tap')}</button>
        </div>
      )}
    </section>
  );
}
