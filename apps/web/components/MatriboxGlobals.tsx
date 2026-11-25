'use client';

import { useState } from 'react';
import { MB_GLOBALS, type MbGlobalSetting } from '@pocket-master/core';
import type { Matribox } from '@/lib/useMatribox';
import { Dialog } from './Dialog';
import { Segmented } from './SettingsDialog';
import { useI18n } from './I18n';

/** Band 2 (index 1) is the only band whose gain write was captured (mb-38). */
const WRITABLE_BAND = 1;
const CHANNELS = Array.from({ length: 17 }, (_, i) => i);

function Slider(p: { label: string; value: number; min: number; max: number; unit?: string; disabled: boolean; onChange: (v: number) => void }) {
  const fill = ((p.value - p.min) / (p.max - p.min)) * 100;
  const shown = `${p.unit === 'dB' && p.value > 0 ? '+' : ''}${Math.round(p.value * 10) / 10}${p.unit ? ` ${p.unit}` : ''}`;
  return (
    <label className="settings-row">
      <span className="settings-label">{p.label}</span>
      <input
        type="range"
        className="param-slider"
        min={p.min}
        max={p.max}
        step={1}
        value={p.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange(Number(e.target.value))}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
      />
      <span className="param-value">{shown}</span>
    </label>
  );
}

/**
 * Global options of the Matribox II Pro: the settings whose write was captured from the official
 * editor (core globals.ts), read when the editor connects and kept up to date with what is changed
 * on the unit. Each change is one write, confirmed by the unit; Global Tempo is shown only.
 */
export function MatriboxGlobals({ mb }: { mb: Matribox }) {
  const { t, te } = useI18n();
  const [open, setOpen] = useState(false);
  const g = mb.globals;
  const off = mb.busy !== null || !g;
  const general = g?.general;
  const set = (setting: MbGlobalSetting) => (v: number) => mb.setGlobal(setting, v);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={mb.busy !== null}
        onClick={() => {
          mb.clearError();
          setOpen(true);
        }}
      >
        {t('settings.open')}
      </button>
      <Dialog open={open} title={t('settings.title')} onClose={() => setOpen(false)}>
        {!g || !general ? (
          <p className="muted">{mb.busy ? t('settings.reading') : t('settings.unreadable')}</p>
        ) : (
          <div className="settings">
            <section className="settings-group" aria-label={t('mbGlobal.inOut')}>
              <h3>{t('mbGlobal.inOut')}</h3>
              <Segmented
                label={t('mbGlobal.inputMode')}
                value={general.inputMode}
                options={[t('mbGlobal.acoustic'), t('mbGlobal.electric'), t('mbGlobal.line')]}
                disabled={off}
                onChange={set('inputMode')}
              />
              <Slider
                label={t('mbGlobal.inputLevel')}
                value={general.inputLevel}
                min={MB_GLOBALS.inputLevel.min}
                max={MB_GLOBALS.inputLevel.max}
                unit="dB"
                disabled={off}
                onChange={set('inputLevel')}
              />
              <Slider label={t('mbGlobal.auxLevel')} value={general.auxLevel} min={MB_GLOBALS.auxLevel.min} max={MB_GLOBALS.auxLevel.max} disabled={off} onChange={set('auxLevel')} />
            </section>
            <section className="settings-group" aria-label={t('mbGlobal.functions')}>
              <h3>{t('mbGlobal.functions')}</h3>
              <Segmented label={t('mbGlobal.mode')} value={general.currentMode} options={['Preset', 'Stomp']} disabled={off} onChange={set('currentMode')} />
              <div className="settings-row">
                <span className="settings-label">{t('mbGlobal.tempo')}</span>
                <span className="param-value">{general.tempo.on && general.tempo.bpm !== null ? t('mbGlobal.tempoOn', { bpm: general.tempo.bpm }) : t('block.off')}</span>
              </div>
              <p className="muted small">{t('mbGlobal.tempoNote')}</p>
            </section>
            <section className="settings-group" aria-label="MIDI">
              <h3>MIDI</h3>
              <label className="settings-row">
                <span className="settings-label">{t('mbGlobal.channel')}</span>
                <select className="param-select" value={general.midiChannelUsb} disabled={off} onChange={(e) => mb.setGlobal('midiChannelUsb', Number(e.target.value))}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c === 0 ? 'Omni' : c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-row">
                <span className="settings-label">{t('mbGlobal.source')}</span>
                <select className="param-select" value={general.midiSource} disabled={off} onChange={(e) => mb.setGlobal('midiSource', Number(e.target.value))}>
                  <option value={0} disabled>
                    {t('mbGlobal.sourceTrs')}
                  </option>
                  <option value={1}>{t('mbGlobal.sourceUsb')}</option>
                  <option value={2}>{t('mbGlobal.sourceMixed')}</option>
                </select>
              </label>
              <p className="muted small">{t('mbGlobal.sourceNote')}</p>
            </section>
            <section className="settings-group" aria-label={t('mbGlobal.eq')}>
              <h3>{t('mbGlobal.eq')}</h3>
              <div className="settings-row">
                <span className="settings-label">{t('mbGlobal.eqOn')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={g.eqOn}
                  aria-label={t('mbGlobal.eqOn')}
                  className={`switch${g.eqOn ? ' switch-on' : ''}`}
                  disabled={off}
                  onClick={() => mb.setEqOn(!g.eqOn)}
                >
                  <span className="switch-knob" />
                </button>
              </div>
              <Slider label={t('mbGlobal.eqLevel')} value={g.eq.level} min={0} max={100} disabled={off} onChange={mb.setEqLevel} />
              {g.eq.bands.map((b, i) => (
                <Slider
                  key={`band${i + 1}`}
                  label={t('mbGlobal.band', { n: i + 1, freq: `${Math.round(b.frequency)} Hz` })}
                  value={b.gain}
                  min={-20}
                  max={20}
                  unit="dB"
                  disabled={off || i !== WRITABLE_BAND}
                  onChange={(v) => mb.setEqGain(i, v)}
                />
              ))}
              <p className="muted small">{t('mbGlobal.bandNote')}</p>
            </section>
          </div>
        )}
        {mb.error && (
          <p className="alert" role="alert">
            {te(mb.error)}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
            {t('action.done')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
