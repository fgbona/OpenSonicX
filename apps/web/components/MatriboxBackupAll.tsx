'use client';

import { useState } from 'react';
import { MB_PRESET_COUNT, parseMbBackupAll, type MbBackupAll } from '@pocket-master/core';
import { downloadJson } from '@/lib/backupStore';
import type { Matribox } from '@/lib/useMatribox';
import { Dialog } from './Dialog';
import { ProgressBar } from './ProgressBar';
import { useI18n } from './I18n';

export const mbAllFileName = (file: MbBackupAll) => `matribox-all-${file.createdAt.replace(/:/g, '-').replace(/\..*$/, '')}.json`;

interface Props {
  mb: Matribox;
  /** Label of the loaded preset (1A..60D). */
  loaded: string;
}

/**
 * Back up all 240 presets to one file, and restore them from one. Both load slot after slot (the
 * unit shows what a slot stores only once loaded), so unsaved edits are lost: asked first.
 */
export function MatriboxBackupAll({ mb, loaded }: Props) {
  const { t, te } = useI18n();
  const [asking, setAsking] = useState(false);
  const [backedUp, setBackedUp] = useState<number | null>(null);
  const [pending, setPending] = useState<MbBackupAll | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [backupFirst, setBackupFirst] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [restored, setRestored] = useState(false);
  const disabled = mb.busy !== null;

  const backup = async () => {
    setAsking(false);
    const file = await mb.backupAll();
    if (!file) return;
    downloadJson(file, mbAllFileName(file));
    setBackedUp(file.presets.length);
  };
  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    setFileError(null);
    try {
      const file = parseMbBackupAll(await chosen.text());
      mb.clearError();
      setBackupFirst(true);
      setConfirmed(false);
      setRestored(false);
      setPending(file);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };
  const restore = async (file: MbBackupAll) => {
    const before = backupFirst ? (b: MbBackupAll) => downloadJson(b, mbAllFileName(b)) : null;
    if (await mb.restoreAll(file, before)) setRestored(true);
  };
  const count = pending?.presets.length ?? 0;

  return (
    <section className="panel" aria-label={t('mb.allTitle')}>
      <div className="panel-head">
        <h2>{t('mb.allTitle')}</h2>
      </div>
      <p className="muted small">{t('mb.allNote')}</p>
      <div className="mb-head-actions">
        <button type="button" className="btn" disabled={disabled} onClick={() => (mb.edited ? setAsking(true) : void backup())}>
          {t('mb.backupAll')}
        </button>
        <label className="btn">
          {t('mb.restoreAll')}
          <input type="file" hidden accept=".json,application/json" aria-label={t('mb.allPick')} disabled={disabled} onChange={(e) => void pick(e.currentTarget)} />
        </label>
      </div>
      {mb.busy === 'Backing up' && !pending && mb.progress && <ProgressBar progress={mb.progress} />}
      {backedUp !== null && mb.busy === null && (
        <p className="small" role="status">
          {t('mb.backupAllDone', { count: backedUp })}
        </p>
      )}
      {fileError && (
        <p className="alert" role="alert">
          {te(fileError)}
        </p>
      )}

      <Dialog open={asking} title={t('mb.backupAll')} onClose={() => setAsking(false)}>
        <p>{t('mb.allEdited', { slot: loaded })}</p>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => setAsking(false)}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void backup()}>
            {t('mb.backupAllAnyway')}
          </button>
        </div>
      </Dialog>

      <Dialog open={pending !== null} title={t('mb.restoreAllTitle', { count })} onClose={() => setPending(null)} locked={disabled}>
        {disabled && mb.progress ? (
          <>
            <ProgressBar progress={mb.progress} />
            <p className="muted small">{t('mb.restoreAllWorking')}</p>
          </>
        ) : restored ? (
          <>
            <p>{t('mb.restoreAllDone', { count })}</p>
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" onClick={() => setPending(null)}>
                {t('action.done')}
              </button>
            </div>
          </>
        ) : pending ? (
          <form
            className="sheet-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmed) void restore(pending);
            }}
          >
            <div className="sheet-note">
              <p>
                <strong>{t('mb.restoreAllWarn', { count, total: MB_PRESET_COUNT, date: new Date(pending.createdAt).toLocaleString() })}</strong>
              </p>
              <p>{t('mb.restoreAllNote', { slot: loaded })}</p>
            </div>
            <label className="mb-confirm">
              <input type="checkbox" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} />
              <span>{t('mb.restoreAllBackupFirst', { total: MB_PRESET_COUNT })}</span>
            </label>
            <label className="mb-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{t('mb.restoreAllConfirm', { count })}</span>
            </label>
            {mb.error && (
              <p className="alert" role="alert">
                {te(mb.error)}
              </p>
            )}
            <div className="sheet-actions">
              <button type="button" className="btn" onClick={() => setPending(null)}>
                {t('action.cancel')}
              </button>
              <button type="submit" className="btn btn-danger" disabled={!confirmed}>
                {t('mb.restoreAllSubmit', { count })}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
