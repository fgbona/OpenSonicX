'use client';

import { useEffect, useRef, useState } from 'react';
import { comparePresets, type Difference, type ToneHost, type ToneSnapshot } from '@pocket-master/core';
import { loadKey, maskKey, removeKey, saveKey } from '@/lib/aiKey';
import { nextReset, recordRequest, usedToday, useAiUsage, type AiModel } from '@/lib/aiUsage';
import { converse, GEMINI_MODELS, KeyError, QuotaError, testKey, type Step } from '@/lib/gemini';
import { Changes, DIFF_KEY } from './PresetFiles';
import { useI18n } from './I18n';

interface Props {
  host: ToneHost;
  liveEdit: boolean;
  onLiveEdit: () => void;
}

interface Message {
  readonly role: 'user' | 'assistant' | 'error';
  readonly text: string;
  readonly changes?: readonly Difference[];
}

/** What the reply changed on the loaded preset; nothing when another preset is loaded now. */
const changed = (before: ToneSnapshot, after: ToneSnapshot) => (before.index === after.index ? comparePresets(before.preset, after.preset) : []);

const STUDIO_KEYS = 'https://aistudio.google.com/apikey';
const STUDIO_LIMITS = 'https://aistudio.google.com/rate-limit';

/** Chat that builds tones on the pedal from a description, with the person's free Gemini key. */
export function AssistantPanel({ host, liveEdit, onLiveEdit }: Props) {
  const { t, lang } = useI18n();
  const [key, setKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<'idle' | 'testing' | 'invalid' | 'unavailable'>('idle');
  const [model, setModel] = useState<AiModel>('flash');
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Step[]>([]);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [quotaUntil, setQuotaUntil] = useState<Date | null>(null);
  const [needLive, setNeedLive] = useState(false);
  const usage = useAiUsage();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setKey(loadKey()); }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages, working]);
  useEffect(() => { if (liveEdit) setNeedLive(false); }, [liveEdit]);

  const time = (d: Date) => d.toLocaleTimeString(lang === 'pt' ? 'pt-BR' : 'en', { hour: '2-digit', minute: '2-digit' });
  const label = (d: Difference) => (d.what === 'param' ? d.name : t(DIFF_KEY[d.what]));

  const addKey = async () => {
    const candidate = keyInput.trim();
    if (!candidate) return;
    setKeyStatus('testing');
    const result = await testKey(candidate);
    if (result !== 'ok') return setKeyStatus(result);
    saveKey(candidate);
    setKey(candidate);
    setKeyInput('');
    setKeyStatus('idle');
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || !key || working) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setWorking(true);
    let before: ToneSnapshot | null = null;
    try {
      before = host.snapshot();
      const result = await converse({
        key, model, history, message, host,
        onRequest: () => recordRequest(model),
        onStep: (_tool, ok, text) => { if (!ok && text.includes('Live edit is off')) setNeedLive(true); },
      });
      const changes = changed(before, host.snapshot());
      setHistory(result.history);
      setMessages((m) => [...m, { role: 'assistant', text: result.reply || '…', changes }]);
    } catch (error) {
      if (error instanceof QuotaError) setQuotaUntil(error.retryAt);
      const text = error instanceof QuotaError ? t('assistant.quota', { time: time(error.retryAt) })
        : error instanceof KeyError ? t('assistant.keyRejected')
          : t('assistant.error', { reason: error instanceof Error ? error.message : String(error) });
      const changes = before ? changed(before, host.snapshot()) : [];
      setMessages((m) => [...m, { role: 'error', text, changes }]);
    } finally {
      setWorking(false);
    }
  };

  const forget = () => {
    removeKey();
    setKey(null);
    setMessages([]);
    setHistory([]);
  };

  const limit = GEMINI_MODELS[model].freeDailyLimit;
  const now = new Date();
  const used = usedToday(usage, model, now);
  const exhausted = quotaUntil !== null && quotaUntil > now;

  return (
    <section className="panel assistant" aria-label={t('assistant.title')}>
      <header className="panel-head">
        <h2>{t('assistant.title')}</h2>
        {key && (
          <div className="assistant-head-actions">
            {messages.length > 0 && <button type="button" className="btn btn-small" onClick={() => { setMessages([]); setHistory([]); }}>{t('assistant.new')}</button>}
            <button type="button" className="btn btn-small" onClick={forget} title={maskKey(key)}>{t('assistant.removeKey')}</button>
          </div>
        )}
      </header>
      <div className="assistant-body">
        {!key ? (
          <>
            <p>{t('assistant.intro')}</p>
            <ol className="steps assistant-steps">
              <li>{t('assistant.step1')} <a href={STUDIO_KEYS} target="_blank" rel="noreferrer">{t('assistant.openStudio')}</a></li>
              <li>{t('assistant.step2')}</li>
              <li>{t('assistant.step3')}</li>
            </ol>
            <form className="assistant-key" onSubmit={(e) => { e.preventDefault(); void addKey(); }}>
              <label className="field">
                <span>{t('assistant.keyLabel')}</span>
                <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" spellCheck={false} placeholder="AIza…" />
              </label>
              <button type="submit" className="btn btn-primary" disabled={!keyInput.trim() || keyStatus === 'testing'}>
                {keyStatus === 'testing' ? t('assistant.testing') : t('assistant.saveKey')}
              </button>
            </form>
            {keyStatus === 'invalid' && <p className="alert" role="alert">{t('assistant.keyInvalid')}</p>}
            {keyStatus === 'unavailable' && <p className="alert" role="alert">{t('assistant.keyUnavailable')}</p>}
            <p className="muted small">{t('assistant.privacy')}</p>
          </>
        ) : (
          <>
            {messages.length === 0 && <p className="muted">{t('assistant.hint')}</p>}
            <ol className="assistant-messages" aria-live="polite">
              {messages.map((m, i) => (
                <li key={i} className={`assistant-message is-${m.role}`}>
                  <p>{m.text}</p>
                  {m.changes && m.changes.length > 0 && <Changes differences={m.changes} label={label} title={t('assistant.changes')} />}
                </li>
              ))}
              {working && <li className="assistant-message is-assistant"><p className="muted">{t('assistant.thinking')}</p></li>}
            </ol>
            <div ref={end} />
            {needLive && !liveEdit && (
              <p className="notice assistant-live">
                {t('assistant.needLive')} <button type="button" className="btn btn-small btn-primary" onClick={onLiveEdit}>{t('assistant.turnOnLive')}</button>
              </p>
            )}
            {exhausted && model === 'flash' && (
              <p className="assistant-quota">
                <button type="button" className="btn btn-small" onClick={() => { setModel('lite'); setQuotaUntil(null); }}>{t('assistant.useLite')}</button>
              </p>
            )}
            <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('assistant.placeholder')} aria-label={t('assistant.inputAria')} disabled={working} />
              <button type="submit" className="btn btn-primary" disabled={working || !draft.trim()}>{t('assistant.send')}</button>
            </form>
            <p className="muted small assistant-usage">
              {t('assistant.usage', { model: model === 'flash' ? 'Gemini Flash' : 'Gemini Flash-Lite', used, limit, time: time(nextReset(now)) })}{' '}
              <a href={STUDIO_LIMITS} target="_blank" rel="noreferrer">{t('assistant.usageLink')}</a>
            </p>
            <p className="muted small">{t('assistant.privacy')}</p>
          </>
        )}
      </div>
    </section>
  );
}
