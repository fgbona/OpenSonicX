'use client';

import { useEffect, useState } from 'react';
import { maskKey, type PaidEntry } from '@/lib/aiKey';
import { chatModels, listProviderModels, PAID, paidById, paidName, pickModel, type PaidProvider } from '@/lib/providers';
import { InfoTip } from './InfoTip';
import { useI18n } from './I18n';

interface Props {
  readonly entries: readonly PaidEntry[];
  readonly onChange: (entries: readonly PaidEntry[]) => void;
}

/** The paid providers the person added, each with its model, and a menu to add another. */
export function PaidProviders({ entries, onChange }: Props) {
  const { t } = useI18n();
  const [adding, setAdding] = useState<PaidProvider | null>(null);
  const available = PAID.filter((p) => !entries.some((e) => e.id === p.id));
  const replace = (entry: PaidEntry) => onChange(entries.map((e) => (e.id === entry.id ? entry : e)));

  return (
    <section className="assistant-provider" aria-label={t('assistant.paidTitle')}>
      <h3>
        {t('assistant.paidTitle')}
        <InfoTip text={t('assistant.paidInfo')} />
      </h3>
      <p className="muted small">{t('assistant.paidHint')}</p>
      {entries.map((e) => (
        <PaidRow key={e.id} entry={e} onModel={(model) => replace({ ...e, model })} onRemove={() => onChange(entries.filter((x) => x.id !== e.id))} />
      ))}
      {adding ? (
        <AddPaid
          provider={adding}
          onCancel={() => setAdding(null)}
          onAdded={(entry) => {
            setAdding(null);
            onChange([...entries, entry]);
          }}
        />
      ) : (
        available.length > 0 && (
          <label className="field">
            <span>{t('assistant.addPaid')}</span>
            <select value="" onChange={(e) => setAdding(paidById(e.target.value) ?? null)}>
              <option value="">{t('assistant.choosePaid')}</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {paidName(p, t('assistant.paidTag'))}
                </option>
              ))}
            </select>
          </label>
        )
      )}
    </section>
  );
}

/** An added provider: its masked key, the model it answers with, and Remove. */
function PaidRow({ entry, onModel, onRemove }: { entry: PaidEntry; onModel: (model: string) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const provider = paidById(entry.id)!;
  const name = paidName(provider, t('assistant.paidTag'));
  const [models, setModels] = useState<readonly string[]>([entry.model]);
  useEffect(() => {
    let live = true;
    void listProviderModels(provider, entry.key).then((ids) => {
      if (live && typeof ids !== 'string') setModels(Array.from(new Set([entry.model, ...chatModels(ids)])).sort());
    });
    return () => {
      live = false;
    };
  }, [provider, entry.key, entry.model]);
  return (
    <div className="assistant-paid" role="group" aria-label={name}>
      <p className="assistant-saved">
        <span>
          <strong>{name}</strong> · {t('assistant.keySaved', { key: maskKey(entry.key) })}
        </span>
        <button type="button" className="btn btn-small" onClick={onRemove}>
          {t('assistant.removeKey')}
        </button>
      </p>
      <label className="field">
        <span>{t('assistant.model')}</span>
        <select value={entry.model} onChange={(e) => onModel(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        <a href={provider.limits} target="_blank" rel="noreferrer">
          {t('assistant.setLimit')}
        </a>
      </p>
    </div>
  );
}

/** The key form for a provider: the key is checked with its model list, which also gives the default model. */
function AddPaid({ provider, onCancel, onAdded }: { provider: PaidProvider; onCancel: () => void; onAdded: (entry: PaidEntry) => void }) {
  const { t } = useI18n();
  const name = paidName(provider, t('assistant.paidTag'));
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'invalid' | 'unavailable' | 'noModels'>('idle');
  const add = async () => {
    const candidate = key.trim();
    if (!candidate) return;
    setStatus('testing');
    const ids = await listProviderModels(provider, candidate);
    if (typeof ids === 'string') return setStatus(ids);
    const model = pickModel(provider, ids);
    if (!model) return setStatus('noModels');
    onAdded({ id: provider.id, key: candidate, model });
  };
  return (
    <form
      className="assistant-key"
      aria-label={name}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <p className="small">
        <a href={provider.keys} target="_blank" rel="noreferrer">
          {t('assistant.openKeys', { provider: name })}
        </a>
      </p>
      <label className="field">
        <span>{t('assistant.paidKeyLabel', { provider: name })}</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={provider.placeholder} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!key.trim() || status === 'testing'}>
        {status === 'testing' ? t('assistant.testing') : t('assistant.saveKey')}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        {t('action.cancel')}
      </button>
      {status === 'invalid' && (
        <p className="alert" role="alert">
          {t('assistant.keyInvalid', { provider: name })}
        </p>
      )}
      {status === 'unavailable' && (
        <p className="alert" role="alert">
          {t('assistant.keyUnavailable', { provider: name })}
        </p>
      )}
      {status === 'noModels' && (
        <p className="alert" role="alert">
          {t('assistant.noModels')}
        </p>
      )}
    </form>
  );
}
