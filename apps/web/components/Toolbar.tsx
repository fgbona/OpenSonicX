'use client';

import type { PortOption, Status } from '@/lib/usePocketMaster';
import type { MessageKey } from '@/lib/i18n';
import { LanguageSwitch, useI18n } from './I18n';
import { useEffect, useState } from 'react';
import { bluetoothAvailable } from '@/lib/ble';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  status: Status;
  /** How the pedal is connected, while it is. */
  transport: 'usb' | 'ble' | null;
  inputs: readonly PortOption[];
  outputs: readonly PortOption[];
  inputId: string;
  outputId: string;
  onSelectInput: (id: string) => void;
  onSelectOutput: (id: string) => void;
  onEnable: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRead: () => void;
  liveEdit: boolean;
  modified: boolean;
  onLiveEdit: (on: boolean) => void;
  onRevert: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSave: () => void;
  busy: boolean;
  /** Save needs a preset read from the pedal first. */
  canSave: boolean;
  onSettings: () => void;
  onBluetooth: () => void;
}

/** The shortcut modifier as the keyboard labels it. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const STATUS_KEY: Record<Status, MessageKey> = {
  idle: 'status.idle',
  requesting: 'status.requesting',
  ready: 'status.ready',
  connecting: 'status.connecting',
  connected: 'status.connected',
  reading: 'status.reading',
};

function PortSelect(props: { label: string; ports: readonly PortOption[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <label className="port">
      <span className="port-label">{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} disabled={props.disabled || props.ports.length === 0}>
        {props.ports.length === 0 && <option value="">{t('ports.none')}</option>}
        {props.ports.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

export function Toolbar(p: Props) {
  const { t } = useI18n();
  const linked = p.status === 'connected' || p.status === 'reading';
  // Known only in the browser; checked after mount so the server and first render agree. Rendered
  // until then: the browsers the editor works in have it, and a late button shifts the page.
  const [bluetooth, setBluetooth] = useState(true);
  useEffect(() => setBluetooth(bluetoothAvailable()), []);
  const bluetoothButton = bluetooth && (
    <button type="button" className="btn" onClick={p.onBluetooth} disabled={p.status === 'connecting'}>{t('action.bluetooth')}</button>
  );
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>◉</span>
        <span>Pocket Master Editor</span>
      </div>
      <div className="ports">
        {p.transport === 'ble' && linked ? (
          // The USB MIDI ports have nothing to do with a Bluetooth connection: show that one instead.
          <span className="port port-ble">{t('ports.bluetooth')}</span>
        ) : (
          <>
            <PortSelect label={t('ports.input')} ports={p.inputs} value={p.inputId} onChange={p.onSelectInput} disabled={linked || p.status === 'idle' || p.status === 'connecting'} />
            <PortSelect label={t('ports.output')} ports={p.outputs} value={p.outputId} onChange={p.onSelectOutput} disabled={linked || p.status === 'idle' || p.status === 'connecting'} />
          </>
        )}
      </div>
      <div className="actions">
        <ThemeToggle />
        <LanguageSwitch />
        <span className={`status status-${p.status}`} role="status">
          <span className="status-dot" aria-hidden />
          {t(STATUS_KEY[p.status])}
        </span>
        {p.status === 'idle' || p.status === 'requesting' ? (
          <>
            {bluetoothButton}
            <button className="btn btn-primary" onClick={p.onEnable} disabled={p.status === 'requesting'}>{t('action.enable')}</button>
          </>
        ) : linked ? (
          <>
            <label className="live-toggle">
              <span>{t('live.label')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={p.liveEdit}
                className={`switch${p.liveEdit ? ' switch-on' : ''}`}
                onClick={() => p.onLiveEdit(!p.liveEdit)}
              >
                <span className="switch-knob" />
              </button>
            </label>
            {p.liveEdit && (
              <>
                <button type="button" className="btn btn-icon" onClick={p.onUndo} disabled={!p.canUndo} aria-label={t('action.undo')} title={`${t('action.undo')} (${MOD}Z)`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
                </button>
                <button type="button" className="btn btn-icon" onClick={p.onRedo} disabled={!p.canRedo} aria-label={t('action.redo')} title={`${t('action.redo')} (${MOD}⇧Z)`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
                </button>
                <button className="btn" onClick={p.onRevert} disabled={!p.modified}>{t('action.revert')}</button>
              </>
            )}
            <button className="btn" onClick={p.onSave} disabled={p.busy || !p.canSave}>{t('action.save')}</button>
            <button className="btn btn-primary" onClick={p.onRead} disabled={p.status === 'reading' || p.busy}>{t('action.read')}</button>
            <button type="button" className="btn btn-icon" onClick={p.onSettings} disabled={p.busy} aria-label={t('settings.open')} title={t('settings.open')}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
            <button className="btn" onClick={p.onDisconnect} disabled={p.busy}>{t('action.disconnect')}</button>
          </>
        ) : (
          <>
            {bluetoothButton}
            <button className="btn btn-primary" onClick={p.onConnect} disabled={!p.inputId || !p.outputId || p.status === 'connecting'}>{t('action.connect')}</button>
          </>
        )}
      </div>
    </header>
  );
}
