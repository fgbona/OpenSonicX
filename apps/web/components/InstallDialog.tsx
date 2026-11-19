'use client';

import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { useI18n } from './I18n';
import { install, NAME_MAX, slotName, type Exclusive, type InstallSource } from '@/lib/install';

interface Props {
  /** One entry per model; a select picks among several. Null closes the dialog. */
  sources: readonly InstallSource[] | null;
  irNames: readonly (string | null)[] | null;
  profileNames: readonly (string | null)[] | null;
  exclusive: Exclusive;
  /** The hook's last error, shown when the upload failed. */
  error: string | null;
  onClose: () => void;
}

type Stage = 'idle' | 'load' | 'download' | 'probe' | 'fit' | 'upload' | 'done';

/** Picks the slot and name, warns about overwriting, then converts (for captures) and writes. */
export function InstallDialog({ sources, irNames, profileNames, exclusive, error, onClose }: Props) {
  const { t, te } = useI18n();
  const [pick, setPick] = useState(0);
  const [slot, setSlot] = useState(1);
  const [name, setName] = useState('');
  const [replace, setReplace] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [probe, setProbe] = useState({ done: 0, total: 5 });
  const [failure, setFailure] = useState<string | null>(null);
  const source = sources?.[pick] ?? null;
  const names = source?.kind === 'ir' ? irNames : profileNames;

  useEffect(() => {
    if (!sources) return;
    setPick(0);
    setStage('idle');
    setFailure(null);
    setReplace(false);
  }, [sources]);

  useEffect(() => {
    if (!source) return;
    setName(slotName(source.name, source.kind));
    const firstEmpty = (names ?? []).findIndex((n) => n === null);
    setSlot(firstEmpty >= 0 ? firstEmpty + 1 : 1);
    setReplace(false);
  }, [source, names]);

  const occupied = names?.[slot - 1] ?? null;
  const running = stage !== 'idle' && stage !== 'done';
  const canInstall = source !== null && name.trim() !== '' && (occupied === null || replace) && !running;

  const run = async () => {
    if (!source) return;
    setFailure(null);
    setStage('load');
    try {
      const ok = await install(source, slot - 1, name.trim(), exclusive, (s) => {
        setStage(s.stage);
        if (s.stage === 'probe') setProbe({ done: s.done, total: s.total });
      });
      setStage(ok ? 'done' : 'idle');
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setStage('idle');
    }
  };

  const stageText = stage === 'probe' ? t('install.stageProbe', probe)
    : stage === 'load' ? t('install.stageLoad') : stage === 'download' ? t('install.stageDownload')
      : stage === 'fit' ? t('install.stageFit') : stage === 'upload' ? t('install.stageUpload') : '';

  return (
    <Dialog open={sources !== null} title={t('install.title')} onClose={onClose} locked={running}>
      {!source ? null : stage === 'done' ? (
        <>
          <p>{t(source.kind === 'ir' ? 'install.doneIr' : 'install.doneProfile', { name: name.trim(), n: slot })}</p>
          <div className="sheet-actions"><button className="btn btn-primary" onClick={onClose}>{t('action.done')}</button></div>
        </>
      ) : (
        <>
          {sources && sources.length > 1 && (
            <label className="field">
              {t('install.model')}
              <select value={pick} disabled={running} onChange={(e) => setPick(Number(e.target.value))}>
                {sources.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            {t(source.kind === 'ir' ? 'install.slotIr' : 'install.slotProfile')}
            <select value={slot} disabled={running} onChange={(e) => { setSlot(Number(e.target.value)); setReplace(false); }}>
              {Array.from({ length: 5 }, (_, i) => (
                <option key={i} value={i + 1}>{t('install.slotOption', { n: i + 1, name: names?.[i] ?? t('install.empty') })}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('install.name')}
            <input value={name} maxLength={NAME_MAX[source.kind]} disabled={running} onChange={(e) => setName(e.target.value.replace(/[^\x20-\x7e]/g, ''))} />
          </label>
          {occupied !== null && (
            <label className="check">
              <input type="checkbox" checked={replace} disabled={running} onChange={(e) => setReplace(e.target.checked)} />
              <span>{t('install.replace', { name: occupied })}</span>
            </label>
          )}
          {source.kind === 'profile' && <p className="muted small">{t('install.slowNote')}</p>}
          {running && <p className="install-stage" role="status"><span className="spinner" aria-hidden="true" /> {stageText}</p>}
          {(failure ?? (stage === 'idle' ? error : null)) && <p className="alert" role="alert">{te(failure ?? error ?? '')}</p>}
          <div className="sheet-actions">
            <button className="btn" onClick={onClose} disabled={running}>{t('action.cancel')}</button>
            <button className={`btn ${occupied ? 'btn-danger' : 'btn-primary'}`} onClick={() => void run()} disabled={!canInstall}>{t('install.submit')}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
