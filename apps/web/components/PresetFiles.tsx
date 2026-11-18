'use client';

import { useState } from 'react';
import { parsePresetFile, type PresetFile, type Progress } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { ProgressBar } from './ProgressBar';
import { useI18n } from './I18n';

interface Props {
  connected: boolean;
  busy: Progress | null;
  error: string | null;
  onExport: () => void;
  onImport: (file: PresetFile) => Promise<boolean>;
  onError: (message: string) => void;
}

/** Export the edit buffer as a file, or load a file into it after a confirmation. */
export function PresetFiles({ connected, busy, error, onExport, onImport, onError }: Props) {
  const { t, te } = useI18n();
  const [pending, setPending] = useState<PresetFile | null>(null);
  const [done, setDone] = useState(false);
  const disabled = !connected || busy !== null;

  const pick = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      setDone(false);
      setPending(parsePresetFile(await file.text()));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const name = pending?.name || t('presetFile.unnamed');
  return (
    <div className="preset-files">
      <button type="button" className="btn btn-small" onClick={onExport} disabled={disabled}>{t('presetFile.export')}</button>
      <label className={`btn btn-small file-button${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled}>
        {t('presetFile.import')}
        <input type="file" accept="application/json,.json" disabled={disabled} onChange={(e) => void pick(e.currentTarget)} />
      </label>
      <Dialog open={pending !== null} title={t('presetFile.title')} onClose={() => setPending(null)} locked={busy !== null}>
        {busy ? (
          <ProgressBar progress={busy} />
        ) : done ? (
          <>
            <p>{t('presetFile.done', { name })}</p>
            <div className="sheet-actions"><button className="btn btn-primary" onClick={() => setPending(null)}>{t('action.done')}</button></div>
          </>
        ) : (
          <>
            <div className="sheet-note">
              <p><strong>{t('presetFile.confirm', { name })}</strong></p>
              <p>{t('presetFile.note')}</p>
            </div>
            {error && <p className="alert" role="alert">{te(error)}</p>}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setPending(null)}>{t('action.cancel')}</button>
              <button className="btn btn-primary" onClick={async () => { if (pending && (await onImport(pending))) setDone(true); }}>
                {t('presetFile.submit')}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
