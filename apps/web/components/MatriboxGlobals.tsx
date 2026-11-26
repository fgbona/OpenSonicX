'use client';

import { useState } from 'react';
import { MB_GLOBALS, type MbEqBand, type MbGlobalSetting } from '@pocket-master/core';
import type { Matribox } from '@/lib/useMatribox';
import { Dialog } from './Dialog';
import { RigLookSwitch } from './rig/RigLookSwitch';
import { Segmented } from './SettingsDialog';
import { useI18n } from './I18n';

const CHANNELS = Array.from({ length: 17 }, (_, i) => i);
/** The cut filters' frequencies that mean off (19 Hz low, 20001 Hz high). */
const LOW_CUT_OFF = 19;
const HIGH_CUT_OFF = 20001;
const { tempoBpm } = MB_GLOBALS;

function Switch(p: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="settings-row">
      <span className="settings-label">{p.label}</span>
      <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} className={`switch${p.on ? ' switch-on' : ''}`} disabled={p.disabled} onClick={() => p.onChange(!p.on)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function ChannelSelect(p: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <label className="settings-row">
      <span className="settings-label">{p.label}</span>
      <select className="param-select" value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(Number(e.target.value))}>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {c === 0 ? 'Omni' : c}
          </option>
        ))}
      </select>
    </label>
  );
}

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
 * on the unit. Each change is one write, confirmed by the unit; brightness and the EQ's frequencies are shown only.
 */
/** `icon`: a gear button (the rig view's header) instead of the labelled one. */
export function MatriboxGlobals({ mb, icon = false }: { mb: Matribox; icon?: boolean }) {
  const { t, te } = useI18n();
  const [open, setOpen] = useState(false);
  const g = mb.globals;
  const off = mb.busy !== null || !g;
  const general = g?.general;
  const set = (setting: MbGlobalSetting) => (v: number) => mb.setGlobal(setting, v);
  const hz = (b: MbEqBand, offAt: number) => (b.on && b.frequency !== offAt ? `${Math.round(b.frequency)} Hz` : t('mbGlobal.cutOff'));
  return (
    <>
      <button
        type="button"
        className={icon ? 'rig-icon-button' : 'btn'}
        aria-label={icon ? t('settings.open') : undefined}
        disabled={mb.busy !== null}
        onClick={() => {
          mb.clearError();
          setOpen(true);
        }}
      >
        {icon ? (
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="2.6" />
            <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
            <circle cx="10" cy="10" r="5.4" />
          </svg>
        ) : (
          t('settings.open')
        )}
      </button>
      <Dialog open={open} title={t('settings.title')} onClose={() => setOpen(false)}>
        <RigLookSwitch />
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
              <Segmented label={t('mbGlobal.mode')} value={general.currentMode} options={['Stomp', 'Preset']} disabled={off} onChange={set('currentMode')} />
              <Switch label={t('mbGlobal.tempo')} on={general.tempoOn !== 0} disabled={off} onChange={(on) => mb.setGlobal('tempoOn', on ? 1 : 0)} />
              <Slider
                label={t('mbGlobal.tempoBpm')}
                value={Math.min(Math.max(general.tempoBpm, tempoBpm.min), tempoBpm.max)}
                min={tempoBpm.min}
                max={tempoBpm.max}
                unit="BPM"
                disabled={off}
                onChange={set('tempoBpm')}
              />
              <p className="muted small">{t('mbGlobal.tempoNote')}</p>
              <div className="settings-row">
                <span className="settings-label">{t('mbGlobal.brightness')}</span>
                <span className="param-value">{general.brightness} %</span>
              </div>
            </section>
            <section className="settings-group" aria-label="MIDI">
              <h3>MIDI</h3>
              <ChannelSelect label={t('mbGlobal.channel')} value={general.midiInUsb} disabled={off} onChange={set('midiInUsb')} />
              <ChannelSelect label={t('mbGlobal.channelTrs')} value={general.midiInTrs} disabled={off} onChange={set('midiInTrs')} />
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
              <Switch label={t('mbGlobal.eqOn')} on={g.eqOn} disabled={off} onChange={mb.setEqOn} />
              <Slider label={t('mbGlobal.eqLevel')} value={g.eq.level} min={0} max={100} disabled={off} onChange={mb.setEqLevel} />
              {g.eq.bands.map((b, i) => (
                <Slider
                  key={`band${i + 1}`}
                  label={t('mbGlobal.band', { n: i + 1, freq: `${Math.round(b.frequency)} Hz` })}
                  value={b.gain}
                  min={-20}
                  max={20}
                  unit="dB"
                  disabled={off}
                  onChange={(v) => mb.setEqGain(i, v)}
                />
              ))}
              <p className="muted small">{t('mbGlobal.cuts', { low: hz(g.eq.lowCut, LOW_CUT_OFF), high: hz(g.eq.highCut, HIGH_CUT_OFF) })}</p>
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
