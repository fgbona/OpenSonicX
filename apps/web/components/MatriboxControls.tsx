'use client';

import { useEffect, useState } from 'react';
import { MB_BPM_MAX, MB_BPM_MIN, MB_CC, mbAssignments, mbBpmControlChanges, mbControlChange, mbSwitch, type MbPreset } from '@pocket-master/core';
import { useI18n } from './I18n';

interface Props {
  preset: MbPreset;
  disabled: boolean;
  onVolume: (volume: number) => void;
  /** MIDI Control Changes: the unit does not answer them. */
  onControl: (messages: () => readonly Uint8Array[]) => void;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

/**
 * The loaded preset's patch volume (SysEx, echoed) and a tuner/tempo row sent as the manual's MIDI
 * Control Changes on the unit's MIDI channel. The unit does not report its tuner or tempo back.
 */
export function MatriboxControls({ preset, disabled, onVolume, onControl }: Props) {
  const { t } = useI18n();
  const { volume, tempo } = mbAssignments(preset);
  const [channel, setChannel] = useState(1);
  const [tuner, setTuner] = useState(false);
  const [bpm, setBpm] = useState(tempo);
  useEffect(() => setBpm(tempo), [tempo]);
  const bpmOk = Number.isInteger(bpm) && bpm >= MB_BPM_MIN && bpm <= MB_BPM_MAX;
  return (
    <section className="panel mb-controls" aria-label={t('mb.controls')}>
      <div className="mb-controls-row">
        <label className="field mb-param">
          <span>{t('mb.volume')} <span className="muted">{volume}</span></span>
          <input type="range" min={0} max={100} step={1} value={volume} disabled={disabled} aria-label={t('mb.volume')} onChange={(e) => onVolume(Number(e.target.value))} />
        </label>
      </div>
      <div className="mb-controls-row">
        <label className="mb-switch">
          <input type="checkbox" checked={tuner} onChange={(e) => {
            setTuner(e.target.checked);
            onControl(() => [mbControlChange(channel, MB_CC.tuner, mbSwitch(e.target.checked))]);
          }} />
          <span>{t('mb.tuner')}</span>
        </label>
        <button type="button" className="btn btn-small" onClick={() => onControl(() => [mbControlChange(channel, MB_CC.tapTempo, 127)])}>{t('mb.tap')}</button>
        <label className="mb-switch">
          <span>{t('mb.bpm')}</span>
          <input className="mb-number" type="number" min={MB_BPM_MIN} max={MB_BPM_MAX} step={1} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
        </label>
        <button type="button" className="btn btn-small" disabled={!bpmOk} onClick={() => onControl(() => mbBpmControlChanges(channel, bpm))}>{t('mb.setBpm')}</button>
        <label className="mb-switch">
          <span>{t('mb.channel')}</span>
          <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">{t('mb.ccNote')}</p>
    </section>
  );
}
