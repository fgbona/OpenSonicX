'use client';

import type { PortOption, Status } from '@/lib/usePocketMaster';
import type { MessageKey } from '@/lib/i18n';
import { LanguageSwitch, useI18n } from './I18n';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  status: Status;
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
  onSave: () => void;
  busy: boolean;
  /** Save needs a preset read from the pedal first. */
  canSave: boolean;
}

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
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>◉</span>
        <span>Pocket Master Editor</span>
      </div>
      <div className="ports">
        <PortSelect label={t('ports.input')} ports={p.inputs} value={p.inputId} onChange={p.onSelectInput} disabled={linked || p.status === 'idle' || p.status === 'connecting'} />
        <PortSelect label={t('ports.output')} ports={p.outputs} value={p.outputId} onChange={p.onSelectOutput} disabled={linked || p.status === 'idle' || p.status === 'connecting'} />
      </div>
      <div className="actions">
        <ThemeToggle />
        <LanguageSwitch />
        <span className={`status status-${p.status}`} role="status">
          <span className="status-dot" aria-hidden />
          {t(STATUS_KEY[p.status])}
        </span>
        {p.status === 'idle' || p.status === 'requesting' ? (
          <button className="btn btn-primary" onClick={p.onEnable} disabled={p.status === 'requesting'}>{t('action.enable')}</button>
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
              <button className="btn" onClick={p.onRevert} disabled={!p.modified}>{t('action.revert')}</button>
            )}
            <button className="btn" onClick={p.onSave} disabled={p.busy || !p.canSave}>{t('action.save')}</button>
            <button className="btn btn-primary" onClick={p.onRead} disabled={p.status === 'reading' || p.busy}>{t('action.read')}</button>
            <button className="btn" onClick={p.onDisconnect} disabled={p.busy}>{t('action.disconnect')}</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={p.onConnect} disabled={!p.inputId || !p.outputId || p.status === 'connecting'}>{t('action.connect')}</button>
        )}
      </div>
    </header>
  );
}
