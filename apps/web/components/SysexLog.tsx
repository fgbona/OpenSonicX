'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '@pocket-master/core';
import { useI18n } from './I18n';

const time = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export const formatLogLine = (e: LogEntry) => `${time(e.time)} ${e.dir} ${e.hex}`;

/** One line; memoised so a new packet renders one line, not the whole log. */
const LogLine = memo(function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className={`log-line log-${entry.dir.toLowerCase()}`}>
      <span className="log-time">{time(entry.time)}</span>
      <span className="log-dir">{entry.dir}</span>
      <span className="log-note">{entry.note}</span>
      <span className="log-hex">{entry.hex}</span>
    </div>
  );
});

export function SysexLog({ log, onClear }: { log: readonly LogEntry[]; onClear: () => void }) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Keep the newest line in view without scrolling the page itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: log.length is the trigger (scroll on every new line)
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
    <section className="log" aria-label={t('log.title')}>
      <header className="log-head">
        <h2>
          {t('log.title')} <span className="muted">{log.length}</span>
        </h2>
        <div className="log-actions">
          <button type="button" className="btn btn-small" onClick={copy} disabled={log.length === 0}>
            {copied ? t('log.copied') : t('log.copy')}
          </button>
          <button type="button" className="btn btn-small" onClick={onClear} disabled={log.length === 0}>
            {t('log.clear')}
          </button>
        </div>
      </header>
      <div ref={body} className="log-body" role="log" aria-live="off">
        {log.length === 0 && <p className="muted small log-empty">{t('log.empty')}</p>}
        {log.map((e) => (
          <LogLine key={e.id} entry={e} />
        ))}
      </div>
    </section>
  );
}
