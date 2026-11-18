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
  hasSessionBackup: boolean;
  busy: Progress | null;
  /** Why the last save failed; shown inside the dialog. */
  error: string | null;
  /** Backups the last save took, offered for download. */
  flowBackups: readonly BackupFile[];
  storageWarning: string | null;
  onDownload: (file: BackupFile) => void;
  onSave: (target: number, name: string) => Promise<boolean>;
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

export function SaveDialog({ open, presetIndex, names, hasSessionBackup, busy, error: saveError, flowBackups, storageWarning, onDownload, onSave, onClose }: Props) {
  const initial = presetIndex !== null && presetIndex < USER_PRESETS ? presetIndex : 0;
  const [target, setTarget] = useState(initial);
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initial);
    setDone(false);
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
          <p>Saved to {label} as “{name}” and checked on the pedal.</p>
          <FlowBackups backups={flowBackups} warning={storageWarning} onDownload={onDownload} />
          <div className="sheet-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <form
          className="sheet-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (error) return;
            if (await onSave(target, name)) setDone(true);
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
          <div className="sheet-note">
            <p><strong>{label}{current ? ` “${current}”` : ''} will be overwritten.</strong></p>
            <p>
              Before saving, the editor backs up {hasSessionBackup ? 'the target slot' : 'all 50 user presets (once per connection, about 30 seconds) and the target slot'}.
              The pedal switches presets while it does that; your unsaved edits are put back before the save. Backups are kept in this browser and offered for download.
            </p>
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={error !== null}>Back up and save to {label}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
