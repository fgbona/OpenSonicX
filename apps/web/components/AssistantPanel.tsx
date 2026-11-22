'use client';

import { useEffect, useRef, useState } from 'react';
import { presetLabel, type Difference, type ToneHost, type ToneSnapshot } from '@pocket-master/core';
import { loadKey, loadOrder, loadPaid, loadRotate, maskKey, removeKey, saveKey, saveOrder, savePaid, saveRotate, type PaidEntry } from '@/lib/aiKey';
import { nextReset, recordRequest, usedToday, useAiUsage } from '@/lib/aiUsage';
import { ask, askedToSave, BusyError, KeyError, providerOf, QuotaError, RegionError, ROUTE, type AiModel, type Converse, type Cooldown, type Provider, type Turn } from '@/lib/assistant';
import { converseGemini, GEMINI_MODELS, testGeminiKey } from '@/lib/gemini';
import { converseGroq, GROQ_MODEL, testGroqKey } from '@/lib/groq';
import { converseWith, paidById, paidName } from '@/lib/providers';
import { moveInOrder, orderRoute, rotated } from '@/lib/route-order';
import { toneChanges } from '@/lib/tone-changes';
import type { MessageKey } from '@/lib/i18n';
import { Changes, DIFF_KEY } from './PresetFiles';
import { PaidProviders } from './PaidProviders';
import { AnswerOrder } from './AnswerOrder';
import { InfoTip } from './InfoTip';
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
  readonly model?: AiModel;
  readonly link?: { readonly href: string; readonly text: string };
}

const REGIONS = 'https://ai.google.dev/gemini-api/docs/available-regions';
const EXAMPLES = ['assistant.example1', 'assistant.example2', 'assistant.example3'] as const;

const FREE_CONVERSE: Readonly<Partial<Record<AiModel, Converse>>> = { groq: converseGroq, flash: converseGemini, lite: converseGemini };
const MODELS: Readonly<Partial<Record<AiModel, { readonly name: string; readonly limit: number; readonly pacificReset: boolean }>>> = {
  groq: { name: 'Groq', limit: GROQ_MODEL.freeDailyLimit, pacificReset: false },
  flash: { name: 'Gemini Flash', limit: GEMINI_MODELS.flash.freeDailyLimit, pacificReset: true },
  lite: { name: 'Gemini Flash-Lite', limit: GEMINI_MODELS.lite.freeDailyLimit, pacificReset: true },
};
const FREE_NAME: Readonly<Partial<Record<Provider, string>>> = { groq: 'Groq', gemini: 'Google Gemini' };
/** A provider's name; a paid one that also has the free setup carries its "(paid)" tag. */
const providerName = (p: Provider, paidTag = '') => FREE_NAME[p] ?? (paidById(p) ? paidName(paidById(p)!, paidTag) : p);

/** How to get each free key; Groq first, since its free quota is the largest. */
const SETUP: readonly {
  readonly provider: 'groq' | 'gemini';
  readonly note: MessageKey;
  readonly link: string;
  readonly linkText: MessageKey;
  readonly steps: readonly MessageKey[];
  readonly label: MessageKey;
  readonly placeholder: string;
  readonly test: (key: string) => Promise<'ok' | 'invalid' | 'unavailable'>;
  readonly usage: string;
}[] = [
  {
    provider: 'groq', note: 'assistant.groqNote', link: 'https://console.groq.com/keys', linkText: 'assistant.openGroq',
    steps: ['assistant.groqStep1', 'assistant.groqStep2', 'assistant.groqStep3'], label: 'assistant.groqKeyLabel', placeholder: 'gsk_…',
    test: (k) => testGroqKey(k), usage: 'https://console.groq.com/settings/limits',
  },
  {
    provider: 'gemini', note: 'assistant.geminiNote', link: 'https://aistudio.google.com/apikey', linkText: 'assistant.openStudio',
    steps: ['assistant.step1', 'assistant.step2', 'assistant.step3'], label: 'assistant.keyLabel', placeholder: 'AIza…',
    test: (k) => testGeminiKey(k), usage: 'https://aistudio.google.com/rate-limit',
  },
];

/** What the reply changed on the loaded preset; undefined when another preset is loaded now (nothing to compare). */
const changed = (before: ToneSnapshot, after: ToneSnapshot, off: string) => (before.index === after.index ? toneChanges(before.preset, after.preset, off) : undefined);

/** One provider's key: how to get it, or the saved one with a way to remove it. */
function KeySetup({ setup, saved, kept, onSaved, onRemove }: { setup: (typeof SETUP)[number]; saved: string | null; kept: boolean; onSaved: (key: string, kept: boolean) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'invalid' | 'unavailable'>('idle');
  const name = providerName(setup.provider);
  const add = async () => {
    const candidate = input.trim();
    if (!candidate) return;
    setStatus('testing');
    const result = await setup.test(candidate);
    if (result !== 'ok') return setStatus(result);
    const kept = saveKey(setup.provider, candidate);
    setInput('');
    setStatus('idle');
    onSaved(candidate, kept);
  };
  return (
    <section className="assistant-provider" aria-label={t('assistant.providerAria', { provider: name })}>
      <h3>{name} <span className="muted small">{t(setup.note)}</span></h3>
      {saved ? (
        <p className="assistant-saved">
          <span>{t(kept ? 'assistant.keySaved' : 'assistant.keyNotKept', { key: maskKey(saved) })}</span>
          <button type="button" className="btn btn-small" onClick={onRemove}>{t('assistant.removeKey')}</button>
        </p>
      ) : (
        <>
          <ol className="steps assistant-steps">
            {setup.steps.map((s, i) => (
              <li key={s}>{t(s)}{i === 0 && <> <a href={setup.link} target="_blank" rel="noreferrer">{t(setup.linkText)}</a></>}</li>
            ))}
          </ol>
          <form className="assistant-key" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <label className="field">
              <span>{t(setup.label)}</span>
              <input type="password" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} placeholder={setup.placeholder} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={!input.trim() || status === 'testing'}>
              {status === 'testing' ? t('assistant.testing') : t('assistant.saveKey')}
            </button>
          </form>
          {status === 'invalid' && <p className="alert" role="alert">{t('assistant.keyInvalid', { provider: name })}</p>}
          {status === 'unavailable' && <p className="alert" role="alert">{t('assistant.keyUnavailable', { provider: name })}</p>}
        </>
      )}
    </section>
  );
}

/** Chat that builds tones on the pedal from a description, with the person's own free AI keys. */
export function AssistantPanel({ host, liveEdit, onLiveEdit }: Props) {
  const { t, lang } = useI18n();
  const [keys, setKeys] = useState<Partial<Record<Provider, string>>>({});
  const [paid, setPaid] = useState<readonly PaidEntry[]>([]);
  const [order, setOrder] = useState<readonly string[]>([]);
  const [rotate, setRotate] = useState(false);
  /** Counts conversations, so rotation starts each new one a provider further. */
  const [round, setRound] = useState(0);
  /** Keys the browser refused to store: they last for this page only. */
  const [notKept, setNotKept] = useState<readonly Provider[]>([]);
  const [managing, setManaging] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [cooldown, setCooldown] = useState<Cooldown>({});
  const [limits, setLimits] = useState<Partial<Record<AiModel, { remaining: number; limit: number }>>>({});
  const [needLive, setNeedLive] = useState(false);
  const usage = useAiUsage();
  const warnedKeys = useRef(new Set<Provider>());
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored: Partial<Record<Provider, string>> = {};
    for (const p of ['groq', 'gemini'] as const) {
      const k = loadKey(p);
      if (k) stored[p] = k;
    }
    setKeys(stored);
    setPaid(loadPaid((id) => paidById(id) !== undefined));
    setOrder(loadOrder());
    setRotate(loadRotate());
  }, []);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Scroll the conversation to the start of the last question, so a long answer is read from the top.
    const ol = list.current;
    const asked = ol?.querySelectorAll<HTMLElement>('.assistant-message.is-user');
    const last = asked?.[asked.length - 1];
    if (ol && last) ol.scrollTop += last.getBoundingClientRect().top - ol.getBoundingClientRect().top;
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages, working]);
  useEffect(() => { if (liveEdit) setNeedLive(false); }, [liveEdit]);

  const time = (d: Date) => d.toLocaleTimeString(lang === 'pt' ? 'pt-BR' : 'en', { hour: '2-digit', minute: '2-digit' });
  const label = (d: Difference) => (d.what === 'param' ? d.name : t(DIFF_KEY[d.what]));
  const hasKey = Object.keys(keys).length > 0 || paid.length > 0;
  const allKeys: Partial<Record<Provider, string>> = { ...keys, ...Object.fromEntries(paid.map((e) => [e.id, e.key])) };
  // The person's order; by default paid providers first, in the order they were added, then the free models.
  const ordered = orderRoute([...paid.map((e) => e.id), ...ROUTE].filter((m) => allKeys[providerOf(m)]), order);
  const route = rotate ? rotated(ordered, round) : ordered;
  const converse: Partial<Record<AiModel, Converse>> = {
    ...FREE_CONVERSE,
    ...Object.fromEntries(paid.map((e) => [e.id, converseWith(paidById(e.id)!, e.model)])),
  };
  const modelName = (m: AiModel) => MODELS[m]?.name ?? `${providerName(m as Provider, t('assistant.paidTag'))} · ${paid.find((e) => e.id === m)?.model ?? ''}`;

  /** Asked to save, but the model did not propose it: open the Save dialog itself; nothing is written until confirmed. */
  const offerSave = (message: string) => {
    const slot = askedToSave(message);
    if (slot === null) return;
    setMessages((m) => [...m, { role: 'assistant', text: t('assistant.saveOpened', { slot: presetLabel(slot) }) }]);
    void host.proposeSave(slot, host.snapshot().name);
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || !hasKey || working) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setWorking(true);
    let before: ToneSnapshot | null = null;
    let proposed = false;
    try {
      before = host.snapshot();
      const result = await ask({
        keys: allKeys, cooldown, converse, route, turns, message, host, language: lang === 'pt' ? 'Brazilian Portuguese' : 'English',
        onRequest: (model) => recordRequest(model),
        onCooldown: setCooldown,
        onLimits: (model, remaining, limit) => setLimits((l) => ({ ...l, [model]: { remaining, limit } })),
        onStep: (tool, ok, text) => {
          if (tool === 'save_preset') proposed = true;
          if (!ok && text.includes('Live edit is off')) setNeedLive(true);
        },
      });
      setCooldown(result.cooldown);
      const reply = result.reply || '…';
      // A key the provider refused, while another provider answered: say it once, or it fails silently on every message.
      const refused = result.badKeys.filter((p) => !warnedKeys.current.has(p));
      refused.forEach((p) => warnedKeys.current.add(p));
      setTurns((h) => [...h, { role: 'user', text: message }, { role: 'assistant', text: reply }]);
      setMessages((m) => [
        ...m,
        ...refused.map((p): Message => ({ role: 'error', text: t('assistant.keyRejected', { provider: providerName(p, t('assistant.paidTag')) }) })),
        { role: 'assistant', text: reply, model: result.model, changes: changed(before!, host.snapshot(), t('assistant.off')) },
      ]);
      if (!proposed) offerSave(message);
    } catch (error) {
      const text = error instanceof BusyError && error.partial && error.model ? t('assistant.busyPartial', { model: modelName(error.model) })
        : error instanceof QuotaError && error.partial && error.model ? t('assistant.quotaPartial', { model: modelName(error.model), time: time(error.retryAt) })
        : error instanceof BusyError ? t('assistant.busy', { time: time(error.retryAt) })
        : error instanceof QuotaError ? t('assistant.quotaAll', { time: time(error.retryAt) })
        : error instanceof KeyError ? t('assistant.keyRejected', { provider: providerName(error.provider, t('assistant.paidTag')) })
        : error instanceof RegionError ? t('assistant.region')
          : t('assistant.error', { reason: error instanceof Error ? error.message : String(error) });
      // The next answer is told this one was cut, so a model does not lose the request (the preset it gets is current).
      setTurns((h) => [...h, { role: 'user', text: message }, { role: 'assistant', text: `(This answer was interrupted: ${error instanceof Error ? error.message : String(error)})` }]);
      const link = error instanceof RegionError ? { href: REGIONS, text: t('assistant.regionLink') } : undefined;
      setMessages((m) => [...m, { role: 'error', text, link, changes: before ? changed(before, host.snapshot(), t('assistant.off')) : undefined }]);
      // Cut after the sound changed: the tone is there, so the save that was asked for is still offered.
      if (!proposed && error instanceof QuotaError && error.partial) offerSave(message);
    } finally {
      setWorking(false);
    }
  };

  const now = new Date();
  const usageLine = (model: AiModel) => {
    const info = MODELS[model];
    if (!info) return t('assistant.paidLine', { model: modelName(model) });
    const until = cooldown[model];
    if (until && until > now) return t('assistant.paused', { model: info.name, time: time(until) });
    const known = limits[model];
    if (known) return t('assistant.left', { model: info.name, remaining: known.remaining, limit: known.limit });
    const used = usedToday(usage, model, now);
    return info.pacificReset
      ? t('assistant.usedReset', { model: info.name, used, limit: info.limit, time: time(nextReset(now)) })
      : t('assistant.used', { model: info.name, used, limit: info.limit });
  };

  return (
    <section className="panel assistant" aria-label={t('assistant.title')}>
      <header className="panel-head">
        <h2>{t('assistant.title')}</h2>
        {hasKey && (
          <div className="assistant-head-actions">
            {!managing && messages.length > 0 && <button type="button" className="btn btn-small" onClick={() => { setMessages([]); setTurns([]); setRound((r) => r + 1); }}>{t('assistant.new')}</button>}
            <button type="button" className="btn btn-small" disabled={working} onClick={() => setManaging(!managing)}>{t(managing ? 'assistant.backToChat' : 'assistant.keys')}</button>
          </div>
        )}
      </header>
      <div className="assistant-body">
        {!hasKey || managing ? (
          <>
            {!hasKey && <p>{t('assistant.intro')}</p>}
            <p className="muted small">{t('assistant.setupHint')}<InfoTip text={t('assistant.freeInfo')} /></p>
            {SETUP.map((s) => (
              <KeySetup key={s.provider} setup={s} saved={keys[s.provider] ?? null} kept={!notKept.includes(s.provider)}
                onSaved={(k, kept) => {
                  setKeys((all) => ({ ...all, [s.provider]: k }));
                  setNotKept((list) => (kept ? list.filter((p) => p !== s.provider) : [...list, s.provider]));
                }}
                onRemove={() => {
                  removeKey(s.provider);
                  warnedKeys.current.delete(s.provider);
                  const { [s.provider]: _gone, ...rest } = keys;
                  setKeys(rest);
                  if (Object.keys(rest).length === 0) setManaging(false); // the next key added goes straight to the chat
                }} />
            ))}
            <PaidProviders entries={paid} onChange={(list) => {
              setPaid(list);
              savePaid(list);
              if (list.length === 0 && Object.keys(keys).length === 0) setManaging(false);
            }} />
            <AnswerOrder order={ordered} name={modelName} rotate={rotate}
              onMove={(m, delta) => { const next = moveInOrder(ordered, m, delta); setOrder(next); saveOrder(next); }}
              onRotate={(on) => { setRotate(on); saveRotate(on); }} />
            <p className="muted small">{t('assistant.privacy')}</p>
          </>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="assistant-examples">
                <p className="muted">{t('assistant.hint')}</p>
                {EXAMPLES.map((k) => (
                  <button key={k} type="button" className="btn btn-small" onClick={() => { setDraft(t(k)); input.current?.focus(); }}>{t(k)}</button>
                ))}
              </div>
            )}
            <ol ref={list} className="assistant-messages" aria-live="polite">
              {messages.map((m, i) => (
                <li key={i} className={`assistant-message is-${m.role}`}>
                  <p>{m.text}{m.link && <> <a href={m.link.href} target="_blank" rel="noreferrer">{m.link.text}</a></>}</p>
                  {m.changes && m.changes.length > 0 && <Changes differences={m.changes} label={label} title={t('assistant.changes')} />}
                  {m.role === 'assistant' && m.changes?.length === 0 && <p className="muted small">{t('assistant.noChanges')}</p>}
                  {m.model && <p className="muted small assistant-via">{t('assistant.via', { model: modelName(m.model) })}</p>}
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
            <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('assistant.placeholder')} aria-label={t('assistant.inputAria')} disabled={working} />
              <button type="submit" className="btn btn-primary" disabled={working || !draft.trim()}>{t('assistant.send')}</button>
            </form>
            <ul className="muted small assistant-usage">
              {ordered.map((m) => <li key={m}>{usageLine(m)}</li>)}
            </ul>
            <p className="muted small">
              {t('assistant.realUsage')}{' '}
              {SETUP.filter((s) => keys[s.provider]).map((s, i) => (
                <span key={s.provider}>{i > 0 && ' · '}<a href={s.usage} target="_blank" rel="noreferrer">{providerName(s.provider)}</a></span>
              ))}
            </p>
            <p className="muted small">{t('assistant.privacy')}</p>
          </>
        )}
      </div>
    </section>
  );
}
