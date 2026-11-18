'use client';

import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '@/lib/midi';

const time = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export const formatLogLine = (e: LogEntry) => `${time(e.time)} ${e.dir} ${e.hex}`;

export function SysexLog({ log, onClear }: { log: readonly LogEntry[]; onClear: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Keep the newest line in view without scrolling the page itself.
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(log.map(formatLogLine).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error('clipboard write failed', error);
    }
  };

  return (
    <section className="log" aria-label="SysEx log">
      <header className="log-head">
        <h2>SysEx log <span className="muted">{log.length}</span></h2>
        <div className="log-actions">
          <button className="btn btn-small" onClick={copy} disabled={log.length === 0}>{copied ? 'Copied' : 'Copy'}</button>
          <button className="btn btn-small" onClick={onClear} disabled={log.length === 0}>Clear</button>
        </div>
      </header>
      <div ref={body} className="log-body" role="log" aria-live="off">
        {log.length === 0 && <p className="muted small log-empty">Every SysEx message sent and received appears here in hex.</p>}
        {log.map((e) => (
          <div key={e.id} className={`log-line log-${e.dir.toLowerCase()}`}>
            <span className="log-time">{time(e.time)}</span>
            <span className="log-dir">{e.dir}</span>
            <span className="log-note">{e.note}</span>
            <span className="log-hex">{e.hex}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
