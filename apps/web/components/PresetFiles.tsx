'use client';

import { useEffect, useState } from 'react';
import { comparePresets, decodePreset, fromHex, parsePresetFile, type Difference, type Preset, type PresetFile, type Progress } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { ProgressBar } from './ProgressBar';
import { useI18n } from './I18n';

interface Props {
  connected: boolean;
  /** The preset on the pedal now, to show what loading a file would change. */
  current: Preset | null;
  busy: Progress | null;
  error: string | null;
  /** The file waiting for confirmation, picked here or in the preset library. */
  pending: PresetFile | null;
  onPick: (file: PresetFile | null) => void;
  onExport: () => void;
  onImport: (file: PresetFile) => Promise<boolean>;
  onError: (message: string) => void;
}

/** Export the edit buffer as a file, or load a file into it after a confirmation. */
export function PresetFiles({ connected, current, busy, error, pending, onPick, onExport, onImport, onError }: Props) {
  const { t, te } = useI18n();
  const label = (d: Difference) => (d.what === 'param' ? d.name : t(DIFF_KEY[d.what]));
  const [done, setDone] = useState(false);
  useEffect(() => { if (pending) setDone(false); }, [pending]);
  const disabled = !connected || busy !== null;

  const pick = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      onPick(parsePresetFile(await file.text()));
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
      <Dialog open={pending !== null} title={t('presetFile.title')} onClose={() => onPick(null)} locked={busy !== null}>
        {busy ? (
          <ProgressBar progress={busy} />
        ) : done ? (
          <>
            <p>{t('presetFile.done', { name })}</p>
            <div className="sheet-actions"><button className="btn btn-primary" onClick={() => onPick(null)}>{t('action.done')}</button></div>
          </>
        ) : (
          <>
            <div className="sheet-note">
              <p><strong>{t('presetFile.confirm', { name })}</strong></p>
              <p>{t('presetFile.note')}</p>
            </div>
            {current && pending && <Changes differences={comparePresets(current, decodePreset(fromHex(pending.payload)))} label={label} />}
            {error && <p className="alert" role="alert">{te(error)}</p>}
            <div className="sheet-actions">
              <button className="btn" onClick={() => onPick(null)}>{t('action.cancel')}</button>
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

const DIFF_KEY = { order: 'diff.order', model: 'diff.model', on: 'diff.onOff', volume: 'diff.volume' } as const;

function Changes({ differences, label }: { differences: readonly Difference[]; label: (d: Difference) => string }) {
  const { t } = useI18n();
  return (
    <section className="changes" aria-label={t('presetFile.changes')}>
      <h3>{t('presetFile.changes')}</h3>
      {differences.length === 0 ? (
        <p className="muted small">{t('presetFile.same')}</p>
      ) : (
        <ul>
          {differences.map((d, i) => (
            <li key={i}>
              <span>{'block' in d ? <strong>{d.block} </strong> : null}{label(d)}</span>
              <span className="changes-values">{d.from} → {d.to}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
