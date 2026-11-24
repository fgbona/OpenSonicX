'use client';

import { useState } from 'react';
import { parseBackupFile, parsePresetFile, type BackupFile, type PresetFile, type Progress, type SlotBackup } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { FlowBackups } from './FlowBackups';
import { useI18n } from './I18n';
import { ProgressBar } from './ProgressBar';
import { PRESET_FILE_ACCEPT, isPrstFile, readPresetFile } from './PresetFiles';

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
  onDelete: (file: BackupFile) => void;
}

/** A date and time in the UI language. */
export const when = (iso: string, lang: string) => new Date(iso).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en');

export function BackupsPanel({ backups, connected, busy, error, flowBackups, storageWarning, onDownload, onImport, onPreset, onRestore, onBackupAll, onRestoreAll, onDelete }: Props) {
  const [pending, setPending] = useState<SlotBackup | null>(null);
  const [done, setDone] = useState(false);
  const [pendingAll, setPendingAll] = useState<BackupFile | null>(null);
  const [doneAll, setDoneAll] = useState(false);
  const [deleting, setDeleting] = useState<BackupFile | null>(null);
  /** What the last import here turned out to be, said next to the button rather than at the top of the page. */
  const [note, setNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** The backup to show open in the list (the one just imported). */
  const [opened, setOpened] = useState<string | null>(null);
  const { t, te, lang } = useI18n();

  const openPreset = (preset: PresetFile) => {
    onPreset(preset);
    setNote(t('backups.presetFile', { name: preset.name }));
  };

  const importFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setNote(null);
    setImportError(null);
    // A .prst from Sonicake's app is always a single preset: open it where it belongs.
    if (isPrstFile(file)) {
      try {
        openPreset(await readPresetFile(file));
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    const text = await file.text();
    try {
      const backup = parseBackupFile(text);
      onImport(backup);
      // The list may already hold it (same file): say what came in and open it, ready to restore.
      setOpened(`${backup.kind}-${backup.createdAt}`);
      setNote(
        t('backups.imported', {
          what: backup.kind === 'session' ? t('backups.all') : `${backup.slots[0]?.label} “${backup.slots[0]?.name}”`,
          count: backup.slots.length,
          when: when(backup.createdAt, lang),
        }),
      );
      return;
    } catch (e) {
      // An exported preset is the likeliest wrong file: open it where it belongs.
      try {
        openPreset(parsePresetFile(text));
      } catch {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <section className="panel" aria-label={t('backups.title')}>
      <header className="panel-head">
        <h2>
          {t('backups.title')} <span className="muted">{backups.length}</span>
        </h2>
        <div className="backup-actions">
          <button type="button" className="btn btn-small btn-primary" disabled={!connected || busy !== null} onClick={() => void onBackupAll()}>
            {t('backups.backupAll')}
          </button>
          <label className="btn btn-small file-button">
            {t('backups.import')}
            <input type="file" title="" accept={PRESET_FILE_ACCEPT} onChange={(e) => void importFile(e.currentTarget)} />
          </label>
        </div>
      </header>
      {note && <p className="notice small">{note}</p>}
      {importError && (
        <p className="alert" role="alert">
          {te(importError)}
        </p>
      )}
      {backups.length === 0 ? (
        <p className="muted small panel-empty">{t('backups.empty')}</p>
      ) : (
        <ul className="backups">
          {backups.map((b) => {
            const id = `${b.kind}-${b.createdAt}`;
            const restoreSlot = (slot: SlotBackup) => {
              setDone(false);
              setPending(slot);
            };
            return (
              <li key={id} className={`backup${opened === id ? ' is-new' : ''}`}>
                {/* The actions are on the card itself; only the slot list folds away. */}
                <div className="backup-head">
                  <div className="backup-title">
                    <strong>{b.kind === 'session' ? t('backups.all') : `${b.slots[0]?.label} “${b.slots[0]?.name}”`}</strong>
                    <span className="muted small">
                      {when(b.createdAt, lang)} · {b.slots.length === 1 ? t('backups.oneSlot') : t('backups.slots', { count: b.slots.length })}
                    </span>
                  </div>
                  <div className="backup-actions">
                    {b.slots.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn-small btn-primary"
                        disabled={!connected || busy !== null}
                        onClick={() => {
                          setDoneAll(false);
                          setPendingAll(b);
                        }}
                      >
                        {t('backups.restoreAll')}
                      </button>
                    ) : (
                      b.slots[0] && (
                        <button type="button" className="btn btn-small btn-primary" disabled={!connected || busy !== null} onClick={() => restoreSlot(b.slots[0]!)}>
                          {t('backups.restoreTo', { slot: b.slots[0].label })}
                        </button>
                      )
                    )}
                    <button type="button" className="btn btn-small" onClick={() => onDownload(b)}>
                      {t('backups.download')}
                    </button>
                    <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => setDeleting(b)}>
                      {t('backups.delete')}
                    </button>
                  </div>
                </div>
                {b.slots.length > 1 && (
                  <details open={opened === id || undefined}>
                    <summary className="btn btn-small backup-toggle">{t('backups.showSlots', { count: b.slots.length })}</summary>
                    <ul className="backup-slots">
                      {b.slots.map((s) => (
                        <li key={s.index}>
                          <span>
                            {s.label} · {s.name || t('backups.unnamed')}
                          </span>
                          <button type="button" className="btn btn-small" disabled={!connected || busy !== null} onClick={() => restoreSlot(s)}>
                            {t('backups.restoreTo', { slot: s.label })}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={deleting !== null} title={t('backups.deleteTitle')} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p>
              {t('backups.deleteNote', { what: deleting.kind === 'session' ? t('backups.all') : `${deleting.slots[0]?.label} “${deleting.slots[0]?.name}”`, when: when(deleting.createdAt, lang) })}
            </p>
            <div className="sheet-actions">
              <button className="btn" onClick={() => onDownload(deleting)}>
                {t('backups.download')}
              </button>
              <button className="btn" onClick={() => setDeleting(null)}>
                {t('action.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  onDelete(deleting);
                  setDeleting(null);
                }}
              >
                {t('backups.delete')}
              </button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog open={pendingAll !== null} title={t('restoreAll.title', { count: pendingAll?.slots.length ?? 0 })} onClose={() => setPendingAll(null)} locked={busy !== null}>
        {busy ? (
          <>
            <ProgressBar progress={busy} />
            <p className="muted small">{t('restoreAll.working')}</p>
          </>
        ) : doneAll ? (
          <>
            <p>{t('restoreAll.done', { count: pendingAll?.slots.length ?? 0 })}</p>
            <div className="sheet-actions">
              <button className="btn btn-primary" onClick={() => setPendingAll(null)}>
                {t('action.done')}
              </button>
            </div>
          </>
        ) : pendingAll ? (
          <>
            <div className="sheet-note">
              <p>{t('restoreAll.note')}</p>
            </div>
            {error && (
              <p className="alert" role="alert">
                {te(error)}
              </p>
            )}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setPendingAll(null)}>
                {t('action.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (await onRestoreAll(pendingAll)) setDoneAll(true);
                }}
              >
                {t('restoreAll.submit')}
              </button>
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
            <div className="sheet-actions">
              <button className="btn btn-primary" onClick={() => setPending(null)}>
                {t('action.done')}
              </button>
            </div>
          </>
        ) : pending ? (
          <>
            <div className="sheet-note">
              <p>
                <strong>{t('restore.overwrite', { slot: pending.label, name: pending.name })}</strong>
              </p>
              <p>{t('restore.note', { slot: pending.label })}</p>
            </div>
            {error && (
              <p className="alert" role="alert">
                {te(error)}
              </p>
            )}
            {error && flowBackups.length > 0 && <FlowBackups backups={flowBackups} warning={storageWarning} onDownload={onDownload} />}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setPending(null)}>
                {t('action.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (await onRestore(pending)) setDone(true);
                }}
              >
                {t('restore.submit')}
              </button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
