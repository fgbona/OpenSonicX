'use client';

import { useEffect, useState } from 'react';
import { encodeName, presetLabel, USER_PRESETS, NAME_LENGTH, type Progress } from '@pocket-master/core';
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

export function SaveDialog({ open, presetIndex, names, hasSessionBackup, busy, error: saveError, onSave, onClose }: Props) {
  const initial = presetIndex !== null && presetIndex < USER_PRESETS ? presetIndex : 0;
  const [target, setTarget] = useState(initial);
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initial);
    setName((names?.[initial] ?? '').slice(0, NAME_LENGTH));
    setDone(false);
  }, [open]); // reset only when the dialog opens

  const current = names?.[target] ?? '';
  const error = nameError(name);
  const label = presetLabel(target);

  return (
    <Dialog open={open} title="Save to a preset slot" onClose={onClose} locked={busy !== null}>
      {busy ? (
        <ProgressBar progress={busy} />
      ) : done ? (
        <>
          <p>Saved to {label} as “{name}” and checked on the pedal. The backups were downloaded and kept in this browser.</p>
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
            <input value={name} maxLength={NAME_LENGTH} onChange={(e) => setName(e.target.value)} aria-invalid={error !== null} autoComplete="off" spellCheck={false} />
          </label>
          {error && name.length > 0 && <p className="field-error">{error}</p>}
          {saveError && <p className="alert" role="alert">{saveError}</p>}
          <div className="sheet-note">
            <p><strong>{label}{current ? ` “${current}”` : ''} will be overwritten.</strong></p>
            <p>
              Before saving, the editor backs up {hasSessionBackup ? 'the target slot' : 'all 50 user presets (once per connection, about 30 seconds) and the target slot'}.
              The pedal switches presets while it does that; your unsaved edits are put back before the save. Backups are downloaded and kept in this browser.
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
