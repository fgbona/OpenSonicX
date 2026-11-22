'use client';

import { useState } from 'react';
import { parseBackupFile, parsePresetFile, type BackupFile, type PresetFile, type Progress, type SlotBackup } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { FlowBackups } from './FlowBackups';
import { useI18n } from './I18n';
import { ProgressBar } from './ProgressBar';

interface Props {
  backups: readonly BackupFile[];
  connected: boolean;
  busy: Progress | null;
  error: string | null;
  flowBackups: readonly BackupFile[];
  storageWarning: string | null;
  onDownload: (file: BackupFile) => void;
  onImport: (file: BackupFile) => void;
  /** A preset file picked here by mistake opens as a preset import instead. */
  onPreset: (file: PresetFile) => void;
  onRestore: (slot: SlotBackup) => Promise<boolean>;
  onBackupAll: () => Promise<boolean>;
  onRestoreAll: (file: BackupFile) => Promise<boolean>;
}

/** A date and time in the UI language. */
export const when = (iso: string, lang: string) => new Date(iso).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en');

export function BackupsPanel({ backups, connected, busy, error, flowBackups, storageWarning, onDownload, onImport, onPreset, onRestore, onBackupAll, onRestoreAll }: Props) {
  const [pending, setPending] = useState<SlotBackup | null>(null);
  const [done, setDone] = useState(false);
  const [pendingAll, setPendingAll] = useState<BackupFile | null>(null);
  const [doneAll, setDoneAll] = useState(false);
  /** What the last import here turned out to be, said next to the button rather than at the top of the page. */
  const [note, setNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** The backup to show open in the list (the one just imported). */
  const [opened, setOpened] = useState<string | null>(null);
  const { t, te, lang } = useI18n();

  const importFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    setNote(null);
    setImportError(null);
    try {
      const backup = parseBackupFile(text);
      onImport(backup);
      // The list may already hold it (same file): say what came in and open it, ready to restore.
      setOpened(`${backup.kind}-${backup.createdAt}`);
      setNote(t('backups.imported', {
        what: backup.kind === 'session' ? t('backups.all') : `${backup.slots[0]?.label} “${backup.slots[0]?.name}”`,
        count: backup.slots.length,
        when: when(backup.createdAt, lang),
      }));
      return;
    } catch (e) {
      // An exported preset is the likeliest wrong file: open it where it belongs.
      try {
        const preset = parsePresetFile(text);
        onPreset(preset);
        setNote(t('backups.presetFile', { name: preset.name }));
      } catch {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <section className="panel" aria-label={t('backups.title')}>
      <header className="panel-head">
        <h2>{t('backups.title')} <span className="muted">{backups.length}</span></h2>
        <button type="button" className="btn btn-small btn-primary" disabled={!connected || busy !== null} onClick={() => void onBackupAll()}>{t('backups.backupAll')}</button>
        <label className="btn btn-small file-button">
          {t('backups.import')}
          <input type="file" accept="application/json,.json" onChange={(e) => void importFile(e.currentTarget)} />
        </label>
      </header>
      {note && <p className="notice small">{note}</p>}
      {importError && <p className="alert" role="alert">{te(importError)}</p>}
      {backups.length === 0 ? (
        <p className="muted small panel-empty">{t('backups.empty')}</p>
      ) : (
        <ul className="backups">
          {backups.map((b) => (
            <li key={`${b.kind}-${b.createdAt}`} className="backup">
              <details open={opened === `${b.kind}-${b.createdAt}` || undefined}>
                <summary>
                  <span className="backup-kind">{b.kind === 'session' ? t('backups.all') : `${b.slots[0]?.label} “${b.slots[0]?.name}”`}</span>
                  <span className="muted small">{when(b.createdAt, lang)} · {b.slots.length === 1 ? t('backups.oneSlot') : t('backups.slots', { count: b.slots.length })}</span>
                </summary>
                <div className="backup-actions">
                  <button type="button" className="btn btn-small" onClick={() => onDownload(b)}>{t('backups.download')}</button>
                  {b.slots.length > 1 && (
                    <button type="button" className="btn btn-small" disabled={!connected || busy !== null} onClick={() => { setDoneAll(false); setPendingAll(b); }}>{t('backups.restoreAll')}</button>
                  )}
                </div>
                <ul className="backup-slots">
                  {b.slots.map((s) => (
                    <li key={s.index}>
                      <span>{s.label} · {s.name || t('backups.unnamed')}</span>
                      <button type="button" className="btn btn-small" disabled={!connected || busy !== null} onClick={() => { setDone(false); setPending(s); }}>
                        {t('backups.restoreTo', { slot: s.label })}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={pendingAll !== null} title={t('restoreAll.title', { count: pendingAll?.slots.length ?? 0 })} onClose={() => setPendingAll(null)} locked={busy !== null}>
        {busy ? (
          <>
            <ProgressBar progress={busy} />
            <p className="muted small">{t('restoreAll.working')}</p>
          </>
        ) : doneAll ? (
          <>
            <p>{t('restoreAll.done', { count: pendingAll?.slots.length ?? 0 })}</p>
            <div className="sheet-actions"><button className="btn btn-primary" onClick={() => setPendingAll(null)}>{t('action.done')}</button></div>
          </>
        ) : pendingAll ? (
          <>
            <div className="sheet-note"><p>{t('restoreAll.note')}</p></div>
            {error && <p className="alert" role="alert">{te(error)}</p>}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setPendingAll(null)}>{t('action.cancel')}</button>
              <button className="btn btn-danger" onClick={async () => { if (await onRestoreAll(pendingAll)) setDoneAll(true); }}>{t('restoreAll.submit')}</button>
            </div>
          </>
        ) : null}
      </Dialog>
      <Dialog open={pending !== null} title={t('restore.title', { slot: pending?.label ?? '' })} onClose={() => setPending(null)} locked={busy !== null}>
        {busy ? (
          <ProgressBar progress={busy} />
        ) : done ? (
          <>
            <p>{t('restore.done', { slot: pending?.label ?? '', name: pending?.name ?? '' })}</p>
            <FlowBackups backups={flowBackups} warning={storageWarning} onDownload={onDownload} />
            <div className="sheet-actions"><button className="btn btn-primary" onClick={() => setPending(null)}>{t('action.done')}</button></div>
          </>
        ) : pending ? (
          <>
            <div className="sheet-note">
              <p><strong>{t('restore.overwrite', { slot: pending.label, name: pending.name })}</strong></p>
              <p>{t('restore.note', { slot: pending.label })}</p>
            </div>
            {error && <p className="alert" role="alert">{te(error)}</p>}
            {error && flowBackups.length > 0 && <FlowBackups backups={flowBackups} warning={storageWarning} onDownload={onDownload} />}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setPending(null)}>{t('action.cancel')}</button>
              <button className="btn btn-danger" onClick={async () => { if (await onRestore(pending)) setDone(true); }}>{t('restore.submit')}</button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
