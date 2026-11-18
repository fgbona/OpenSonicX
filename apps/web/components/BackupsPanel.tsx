'use client';

import { useState } from 'react';
import { parseBackupFile, type BackupFile, type Progress, type SlotBackup } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { ProgressBar } from './ProgressBar';

interface Props {
  backups: readonly BackupFile[];
  connected: boolean;
  busy: Progress | null;
  error: string | null;
  onDownload: (file: BackupFile) => void;
  onImport: (file: BackupFile) => void;
  onRestore: (slot: SlotBackup) => Promise<boolean>;
  onError: (message: string) => void;
}

const when = (iso: string) => new Date(iso).toLocaleString();

export function BackupsPanel({ backups, connected, busy, error, onDownload, onImport, onRestore, onError }: Props) {
  const [pending, setPending] = useState<SlotBackup | null>(null);
  const [done, setDone] = useState(false);

  const importFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      onImport(parseBackupFile(await file.text()));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel" aria-label="Backups">
      <header className="panel-head">
        <h2>Backups <span className="muted">{backups.length}</span></h2>
        <label className="btn btn-small file-button">
          Import file
          <input type="file" accept="application/json,.json" onChange={(e) => void importFile(e.currentTarget)} />
        </label>
      </header>
      {backups.length === 0 ? (
        <p className="muted small panel-empty">Backups appear here after the first save. Each one is also downloaded as a file.</p>
      ) : (
        <ul className="backups">
          {backups.map((b) => (
            <li key={`${b.kind}-${b.createdAt}`} className="backup">
              <details>
                <summary>
                  <span className="backup-kind">{b.kind === 'session' ? 'All user presets' : `${b.slots[0]?.label} “${b.slots[0]?.name}”`}</span>
                  <span className="muted small">{when(b.createdAt)} · {b.slots.length} slot{b.slots.length === 1 ? '' : 's'}</span>
                  <button type="button" className="btn btn-small" onClick={(e) => { e.preventDefault(); onDownload(b); }}>Download</button>
                </summary>
                <ul className="backup-slots">
                  {b.slots.map((s) => (
                    <li key={s.index}>
                      <span>{s.label} · {s.name || 'unnamed'}</span>
                      <button type="button" className="btn btn-small" disabled={!connected || busy !== null} onClick={() => { setDone(false); setPending(s); }}>
                        Restore to {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={pending !== null} title={pending ? `Restore ${pending.label}` : 'Restore'} onClose={() => setPending(null)} locked={busy !== null}>
        {busy ? (
          <ProgressBar progress={busy} />
        ) : done ? (
          <>
            <p>{pending?.label} is back to “{pending?.name}”, checked on the pedal.</p>
            <div className="sheet-actions"><button className="btn btn-primary" onClick={() => setPending(null)}>Done</button></div>
          </>
        ) : pending ? (
          <>
            <div className="sheet-note">
              <p><strong>{pending.label} will be overwritten with the backup “{pending.name}”.</strong></p>
              <p>
                What {pending.label} holds now is backed up first. The pedal loads {pending.label}, so unsaved edits on the
                loaded preset are discarded. Settings the editor does not decode yet (such as tempo) are not restored.
              </p>
            </div>
            {error && <p className="alert" role="alert">{error}</p>}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={async () => { if (await onRestore(pending)) setDone(true); }}>Back up and restore</button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
