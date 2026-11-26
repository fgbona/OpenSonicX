'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './I18n';

/** Seconds of silence before the elapsed counter shows: short answers stay uncluttered. */
const SHOW_AFTER_S = 3;

/** The "working" bubble: a small amp-knob glyph that turns, the busy text and, after a few seconds, how long it has run. */
export function AssistantBusy() {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="muted assistant-busy" role="status">
      <svg className="assistant-busy-dial" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
        <path d="M10 3.5V10" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span>{t('assistant.thinking')}</span>
      {seconds >= SHOW_AFTER_S && <span className="assistant-busy-time">{t('assistant.thinkingTime', { seconds })}</span>}
    </p>
  );
}
