'use client';

import { useState } from 'react';
import type { MbCloneStep } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { useI18n } from './I18n';

interface Props {
  open: boolean;
  /** 1-based CLONE number. */
  slot: number;
  name: string;
  /** The name the slot has now; null when it is empty. */
  current: string | null;
  busy: boolean;
  step: MbCloneStep | null;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** The overwrite of a CLONE slot cannot be undone (the unit cannot send a capture back): a checkbox and a danger button, like the Save dialog. */
export function MatriboxCloneConfirm({ open, slot, name, current, busy, step, error, onConfirm, onClose }: Props) {
  const { t, te } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Dialog open={open} title={t('mbClone.confirmTitle', { slot })} onClose={onClose} locked={busy}>
      {open && (
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed) onConfirm();
          }}
        >
          <div className="sheet-note">
            <p>
              <strong>{current ? t('mbClone.confirmNoteNamed', { slot, name, current }) : t('mbClone.confirmNote', { slot, name })}</strong>
            </p>
            <p>{t('mbClone.confirmUndo')}</p>
          </div>
          <label className="mb-confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
            <span>{t('mbClone.confirm', { slot })}</span>
          </label>
          {busy && step && (
            <p className="muted small" role="status">
              {t(`mbClone.step.${step}`)}
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {te(error)}
            </p>
          )}
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !confirmed}>
              {t(busy ? 'mb.saving' : 'mbClone.write', { slot })}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
