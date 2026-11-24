'use client';

import { useEffect, useState } from 'react';
import { PRESET_COUNT, presetLabel, USER_PRESETS, type Progress } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { useI18n } from './I18n';
import { ProgressBar } from './ProgressBar';

interface Props {
  open: boolean;
  /** The loaded preset, the default source. */
  presetIndex: number | null;
  names: readonly string[] | null;
  busy: Progress | null;
  error: string | null;
  onCopy: (destination: number, source: number) => Promise<boolean>;
  onClose: () => void;
}

const option = (names: readonly string[] | null, i: number) => `${presetLabel(i)}${names?.[i] ? ` · ${names[i]}` : ''}`;

/** Copies a stored preset (user or factory) over a user slot, without loading either. */
export function CopyDialog({ open, presetIndex, names, busy, error, onCopy, onClose }: Props) {
  const { t, te } = useI18n();
  const [source, setSource] = useState(0);
  const [destination, setDestination] = useState(1);
  const [done, setDone] = useState(false);

  // Every opening starts from the loaded preset, into the next user slot.
  useEffect(() => {
    if (!open) return;
    const from = presetIndex ?? 0;
    setSource(from);
    setDestination(from + 1 < USER_PRESETS ? from + 1 : 0);
    setDone(false);
  }, [open, presetIndex]);

  const vars = { source: presetLabel(source), slot: presetLabel(destination), name: names?.[destination] ?? '', from: names?.[source] ?? '' };
  return (
    <Dialog open={open} title={t('copy.title')} onClose={onClose} locked={busy !== null}>
      {busy ? (
        <ProgressBar progress={busy} />
      ) : done ? (
        <>
          <p>{t('copy.done', vars)}</p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('action.done')}
            </button>
          </div>
        </>
      ) : (
        <form
          className="sheet-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onCopy(destination, source)) setDone(true);
          }}
        >
          <label className="field">
            <span>{t('copy.source')}</span>
            <select value={source} onChange={(e) => setSource(Number(e.target.value))}>
              {Array.from({ length: PRESET_COUNT }, (_, i) => (
                <option key={i} value={i}>
                  {option(names, i)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('copy.destination')}</span>
            <select value={destination} onChange={(e) => setDestination(Number(e.target.value))}>
              {Array.from({ length: USER_PRESETS }, (_, i) => (
                <option key={i} value={i} disabled={i === source}>
                  {option(names, i)}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="alert" role="alert">
              {te(error)}
            </p>
          )}
          <div className="sheet-note">
            <p>
              <strong>{t('copy.overwrite', vars)}</strong>
            </p>
            <p>{t('copy.note', vars)}</p>
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('action.cancel')}
            </button>
            <button type="submit" className="btn btn-danger" disabled={source === destination}>
              {t('copy.submit', vars)}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
