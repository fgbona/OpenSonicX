'use client';

import type { PortOption, Status } from '@/lib/usePocketMaster';

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
}

const STATUS_TEXT: Record<Status, string> = {
  idle: 'MIDI off',
  requesting: 'Asking permission…',
  ready: 'Not connected',
  connected: 'Connected',
  reading: 'Reading…',
};

function PortSelect(props: { label: string; ports: readonly PortOption[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  return (
    <label className="port">
      <span className="port-label">{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} disabled={props.disabled || props.ports.length === 0}>
        {props.ports.length === 0 && <option value="">No ports</option>}
        {props.ports.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

export function Toolbar(p: Props) {
  const linked = p.status === 'connected' || p.status === 'reading';
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>◉</span>
        <span>Pocket Master Editor</span>
      </div>
      <div className="ports">
        <PortSelect label="Input" ports={p.inputs} value={p.inputId} onChange={p.onSelectInput} disabled={linked || p.status === 'idle'} />
        <PortSelect label="Output" ports={p.outputs} value={p.outputId} onChange={p.onSelectOutput} disabled={linked || p.status === 'idle'} />
      </div>
      <div className="actions">
        <span className={`status status-${p.status}`} role="status">
          <span className="status-dot" aria-hidden />
          {STATUS_TEXT[p.status]}
        </span>
        {p.status === 'idle' || p.status === 'requesting' ? (
          <button className="btn btn-primary" onClick={p.onEnable} disabled={p.status === 'requesting'}>Enable MIDI</button>
        ) : linked ? (
          <>
            <button className="btn btn-primary" onClick={p.onRead} disabled={p.status === 'reading'}>Read</button>
            <button className="btn" onClick={p.onDisconnect}>Disconnect</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={p.onConnect} disabled={!p.inputId || !p.outputId}>Connect</button>
        )}
      </div>
    </header>
  );
}
