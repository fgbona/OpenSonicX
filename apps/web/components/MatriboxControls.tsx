'use client';

import { useEffect, useState } from 'react';
import { MB_BPM_MAX, MB_BPM_MIN, MB_CC, mbBpmControlChanges, mbControlChange, mbSwitch } from '@pocket-master/core';
import { Fold } from './Fold';
import { useI18n } from './I18n';

interface Props {
  /** The loaded preset's tempo (BPM). */
  tempo: number;
  /** MIDI Control Changes: the unit does not answer them. */
  onControl: (messages: () => readonly Uint8Array[]) => void;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

/**
 * Tuner and tempo, sent as the manual's MIDI Control Changes on the unit's MIDI channel. The unit
 * does not report its tuner or tempo back.
 */
export function MatriboxControls({ tempo, onControl }: Props) {
  const { t } = useI18n();
  const [channel, setChannel] = useState(1);
  const [tuner, setTuner] = useState(false);
  const [bpm, setBpm] = useState(tempo);
  useEffect(() => setBpm(tempo), [tempo]);
  const bpmOk = Number.isInteger(bpm) && bpm >= MB_BPM_MIN && bpm <= MB_BPM_MAX;
  return (
    <Fold title={t('mb.controls')}>
      <div className="mb-body">
        <div className="mb-row">
          <span className="mb-control">
            <button
              type="button"
              role="switch"
              aria-checked={tuner}
              aria-label={t('mb.tuner')}
              className={`switch${tuner ? ' switch-on' : ''}`}
              onClick={() => {
                setTuner(!tuner);
                onControl(() => [mbControlChange(channel, MB_CC.tuner, mbSwitch(!tuner))]);
              }}
            >
              <span className="switch-knob" />
            </button>
            <span aria-hidden="true">{t('mb.tuner')}</span>
          </span>
          <span className="mb-control">
            <label htmlFor="mb-bpm">{t('mb.bpm')}</label>
            <input id="mb-bpm" className="bpm-input mb-number" type="number" min={MB_BPM_MIN} max={MB_BPM_MAX} step={1} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            <button type="button" className="btn btn-small" disabled={!bpmOk} onClick={() => onControl(() => mbBpmControlChanges(channel, bpm))}>
              {t('mb.setBpm')}
            </button>
            <button type="button" className="btn btn-small" onClick={() => onControl(() => [mbControlChange(channel, MB_CC.tapTempo, 127)])}>
              {t('mb.tap')}
            </button>
          </span>
          <span className="mb-control mb-control-end">
            <label htmlFor="mb-channel">{t('mb.channel')}</label>
            <select id="mb-channel" className="param-select" value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </span>
        </div>
        <p className="muted small">{t('mb.ccNote')}</p>
      </div>
    </Fold>
  );
}
