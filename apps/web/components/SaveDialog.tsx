'use client';

import { useEffect, useState } from 'react';
import { encodeName, presetLabel, USER_PRESETS, NAME_LENGTH, type BackupFile, type Progress } from '@pocket-master/core';
import { FlowBackups } from './FlowBackups';
import { Dialog } from './Dialog';
import { ProgressBar } from './ProgressBar';

interface Props {
  open: boolean;
  presetIndex: number | null;
  names: readonly string[] | null;
  busy: Progress | null;
  /** Why the last save failed; shown inside the dialog. */
  error: string | null;
  /** Backups the last save took, offered for download. */
  flowBackups: readonly BackupFile[];
  storageWarning: string | null;
  onDownload: (file: BackupFile) => void;
  onSave: (target: number, name: string, backup: boolean) => Promise<boolean>;
  onClose: () => void;
}

const nameError = (name: string) => {
  try {
    encodeName(name);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export function SaveDialog({ open, presetIndex, names, busy, error: saveError, flowBackups, storageWarning, onDownload, onSave, onClose }: Props) {
  const initial = presetIndex !== null && presetIndex < USER_PRESETS ? presetIndex : 0;
  const [target, setTarget] = useState(initial);
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const [skipBackup, setSkipBackup] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initial);
    setDone(false);
    setSkipBackup(false); // backup is on again every time the sheet opens
  }, [open, initial]);

  // Names arrive after the dialog opens; fill the name once they do, without overwriting typing.
  useEffect(() => {
    if (open && names) setName((n) => n || (names[target] ?? '').trim().slice(0, NAME_LENGTH));
  }, [open, names, target]);

  const current = names?.[target] ?? '';
  const error = nameError(name);
  const label = presetLabel(target);

  return (
    <Dialog open={open} title="Save to a preset slot" onClose={onClose} locked={busy !== null}>
      {busy ? (
        <ProgressBar progress={busy} />
      ) : done ? (
        <>
          <p>Saved to {label} as “{name}” and checked on the pedal.{skipBackup ? ' No backup was taken.' : ''}</p>
          <FlowBackups backups={flowBackups} warning={storageWarning} onDownload={onDownload} />
          <div className="sheet-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <form
          className="sheet-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (error) return;
            if (await onSave(target, name, !skipBackup)) setDone(true);
          }}
        >
          <label className="field">
            <span>Slot</span>
            <select value={target} onChange={(e) => {
              const index = Number(e.target.value);
              setTarget(index);
              setName((names?.[index] ?? '').slice(0, NAME_LENGTH));
            }}>
              {Array.from({ length: USER_PRESETS }, (_, i) => (
                <option key={i} value={i}>{presetLabel(i)}{names?.[i] ? ` · ${names[i]}` : ''}{i === presetIndex ? ' (loaded)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={NAME_LENGTH} onChange={(e) => setName(e.target.value)} aria-invalid={error !== null} aria-describedby="save-name-error" autoComplete="off" spellCheck={false} />
          </label>
          {error && name.length > 0 && <p className="field-error" id="save-name-error">{error}</p>}
          {saveError && <p className="alert" role="alert">{saveError}</p>}
          {saveError && flowBackups.length > 0 && <FlowBackups backups={flowBackups} warning={storageWarning} onDownload={onDownload} />}
          <label className="check">
            <input type="checkbox" checked={skipBackup} onChange={(e) => setSkipBackup(e.target.checked)} />
            <span>Don't back up {label} before saving</span>
          </label>
          <div className="sheet-note">
            <p><strong>{label}{current ? ` “${current}”` : ''} will be overwritten.</strong></p>
            {skipBackup ? (
              <p>No backup: what {label} holds now cannot be restored from the editor after this save.</p>
            ) : (
              <p>
                Before saving, the editor backs up what {label} holds now. The pedal loads {label} for a moment to read
                it; your unsaved edits are put back before the save. The backup is kept in this browser and offered for download.
              </p>
            )}
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={error !== null}>{skipBackup ? 'Save' : 'Back up and save'} to {label}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
