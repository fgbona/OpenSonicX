'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { useI18n } from './I18n';
import { install, NAME_MAX, slotName, type Exclusive, type InstallSource } from '@/lib/install';
import { setSlotNote } from '@/lib/slotNotes';

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
  const [attempted, setAttempted] = useState(false);
  const [written, setWritten] = useState<{ slot: number; name: string } | null>(null);
  const source = sources?.[pick] ?? null;
  const names = source?.kind === 'ir' ? irNames : profileNames;
  // Slot names are re-read during and after an install; the defaults come from them only when
  // the source changes, so a re-read never resets what the user chose.
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    if (!sources) return;
    setPick(0);
    setStage('idle');
    setFailure(null);
    setAttempted(false);
    setWritten(null);
    setReplace(false);
  }, [sources]);

  useEffect(() => {
    if (!source) return;
    setName(slotName(source.name, source.kind));
    const known = namesRef.current;
    const firstEmpty = known ? known.findIndex((n) => n === null) : -1;
    setSlot(firstEmpty >= 0 ? firstEmpty + 1 : 1);
    setReplace(false);
  }, [source]);

  // Unread slot names count as occupied: the pedal cannot give back what a slot holds.
  const occupied = names === null ? t('install.unknown') : (names[slot - 1] ?? null);
  const running = stage !== 'idle' && stage !== 'done';
  const canInstall = source !== null && name.trim() !== '' && (occupied === null || replace) && !running;

  const run = async () => {
    if (!source) return;
    setFailure(null);
    setAttempted(true);
    setStage('load');
    const target = { slot, name: name.trim() };
    try {
      const ok = await install(source, target.slot - 1, target.name, exclusive, (s) => {
        setStage(s.stage);
        if (s.stage === 'probe') setProbe({ done: s.done, total: s.total });
      });
      if (ok) {
        setWritten(target);
        if (source.note) setSlotNote(source.kind, target.slot - 1, target.name, source.note);
      }
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
          <p>{t(source.kind === 'ir' ? 'install.doneIr' : 'install.doneProfile', { name: written?.name ?? name.trim(), n: written?.slot ?? slot })}</p>
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
          {(failure ?? (attempted && stage === 'idle' ? error : null)) && <p className="alert" role="alert">{te(failure ?? error ?? '')}</p>}
          <div className="sheet-actions">
            <button className="btn" onClick={onClose} disabled={running}>{t('action.cancel')}</button>
            <button className={`btn ${occupied ? 'btn-danger' : 'btn-primary'}`} onClick={() => void run()} disabled={!canInstall}>{t('install.submit')}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
