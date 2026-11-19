'use client';

import { useState } from 'react';
import type { Tone } from '@pocket-master/core';
import { InstallDialog } from './InstallDialog';
import { useI18n } from './I18n';
import { useTone3000 } from '@/lib/useTone3000';
import type { Exclusive, InstallSource } from '@/lib/install';

interface Props {
  connected: boolean;
  busy: boolean;
  irNames: readonly (string | null)[] | null;
  profileNames: readonly (string | null)[] | null;
  exclusive: Exclusive;
  error: string | null;
}

/**
 * Search TONE3000 and install a capture or IR on the pedal. TONE3000's terms ask third-party
 * apps to show its name, each tone's creator and a way to the full library.
 */
export function Tone3000Panel({ connected, busy, irNames, profileNames, exclusive, error }: Props) {
  const { t, te } = useI18n();
  const t3k = useTone3000();
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<'nam' | 'ir'>('nam');
  const [sources, setSources] = useState<InstallSource[] | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const startInstall = async (tone: Tone) => {
    setLocalError(null);
    setPreparing(tone.id);
    try {
      const models = await t3k.models(tone.id);
      if (models.length === 0) throw new Error(t('t3k.noModels'));
      const kind = tone.format === 'ir' ? 'ir' : 'profile';
      setSources(models.map((m) => ({
        kind,
        label: m.size ? `${m.name} (${m.size})` : m.name,
        name: m.name,
        load: () => t3k.download(m.url),
      })));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(null);
    }
  };

  const results = t3k.results;
  return (
    <section className="panel t3k" aria-label="TONE3000">
      <header className="panel-head">
        <h2><span className="t3k-mark">TONE3000</span></h2>
        {t3k.signedIn && <button type="button" className="btn btn-small" onClick={t3k.signOut}>{t('t3k.signOut')}</button>}
      </header>
      <div className="t3k-body">
        <p className="muted small">{t('t3k.intro')} <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">tone3000.com</a></p>
        {!t3k.configured ? (
          <p className="muted small">{t('t3k.notConfigured')}</p>
        ) : !t3k.signedIn ? (
          t3k.login ? (
            <div className="t3k-login" role="status">
              <p>{t('t3k.code', { link: t3k.login.verificationUri, code: t3k.login.userCode })}</p>
              <p><a className="btn btn-primary btn-small" href={t3k.login.verificationUriComplete} target="_blank" rel="noreferrer">{t3k.login.userCode}</a> <span className="muted small">{t('t3k.waiting')}</span></p>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={t3k.signIn}>{t('t3k.signIn')}</button>
          )
        ) : (
          <>
            <form className="t3k-search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) void t3k.search(query.trim(), format); }}>
              <input type="search" value={query} placeholder={t('t3k.placeholder')} aria-label={t('t3k.search')} onChange={(e) => setQuery(e.target.value)} />
              <select value={format} aria-label={t('t3k.formatNam')} onChange={(e) => setFormat(e.target.value as 'nam' | 'ir')}>
                <option value="nam">{t('t3k.formatNam')}</option>
                <option value="ir">{t('t3k.formatIr')}</option>
              </select>
              <button type="submit" className="btn btn-primary btn-small" disabled={t3k.searching || !query.trim()}>{t('t3k.search')}</button>
            </form>
            {results && results.tones.length === 0 && <p className="muted small">{t('t3k.noResults')}</p>}
            {results && results.tones.length > 0 && (
              <ul className="t3k-results">
                {results.tones.map((tone) => (
                  <li key={tone.id} className="t3k-tone">
                    {tone.image ? <img src={tone.image} alt="" className="t3k-image" loading="lazy" /> : <span className="t3k-image" aria-hidden="true" />}
                    <div className="t3k-info">
                      <strong>{tone.title}</strong>
                      <span className="muted small">{t('t3k.by', { creator: tone.creator })} · {tone.gear || '—'} · {tone.format.toUpperCase()} · {t('t3k.models', { count: tone.modelsCount })} · {t('t3k.downloads', { count: tone.downloads })}</span>
                      {tone.description && <span className="small t3k-desc">{tone.description}</span>}
                      <a className="small" href={tone.url} target="_blank" rel="noreferrer">{t('t3k.view')}</a>
                    </div>
                    <button type="button" className="btn btn-small" disabled={!connected || busy || preparing !== null || tone.modelsCount === 0} onClick={() => void startInstall(tone)}>
                      {preparing === tone.id ? '…' : t('t3k.install')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results && results.page < results.totalPages && (
              <button type="button" className="btn btn-small" disabled={t3k.searching} onClick={() => void t3k.search(query.trim(), format, results.page + 1)}>{t('t3k.more')}</button>
            )}
          </>
        )}
        {(t3k.error ?? localError) && <p className="alert" role="alert">{te(t3k.error ?? localError ?? '')}</p>}
      </div>
      <InstallDialog sources={sources} irNames={irNames} profileNames={profileNames} exclusive={exclusive} error={error} onClose={() => setSources(null)} />
    </section>
  );
}
