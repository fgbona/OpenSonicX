'use client';

import type { ReactNode } from 'react';
import { Knob } from './Knob';
import { RedoIcon, UndoIcon } from './icons';
import { useI18n } from './I18n';

interface Props {
  /** "17C". */
  label: string;
  name: string;
  /** The preset's style tag ("Rock"); '' when it has none. */
  style: string;
  edited: boolean;
  volume: number;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onVolume: (volume: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRead: () => void;
  onSave: () => void;
  /** Preset-file buttons beside Save (export, import). */
  files?: ReactNode;
}

/** The loaded Matribox preset as the Pocket Master's preset header: big label and name, its actions, patch volume as a knob. */
export function MatriboxHeader(p: Props) {
  const { t } = useI18n();
  return (
    <div className="preset-head">
      <div>
        <p className="eyebrow">
          {t('preset.editBuffer')}
          {p.edited ? ` · ${t('mb.edited')}` : ''}
          {p.style && <span className="mb-style">{p.style}</span>}
        </p>
        <h1 className="preset-name">
          {p.label}
          <span className="preset-title"> {p.name}</span>
        </h1>
      </div>
      <div className="mb-head-end">
        <div className="mb-head-actions">
          <button type="button" className="btn btn-icon" disabled={p.disabled || !p.canUndo} aria-label={t('action.undo')} title={t('action.undo')} onClick={p.onUndo}>
            <UndoIcon />
          </button>
          <button type="button" className="btn btn-icon" disabled={p.disabled || !p.canRedo} aria-label={t('action.redo')} title={t('action.redo')} onClick={p.onRedo}>
            <RedoIcon />
          </button>
          <button type="button" className="btn" disabled={p.disabled} onClick={p.onSave}>
            {t('action.save')}
          </button>
          {p.files}
          <button type="button" className="btn btn-primary" disabled={p.disabled} onClick={p.onRead}>
            {t('action.read')}
          </button>
        </div>
        <section className="fields" aria-label={t('fields.aria')}>
          <Knob label={t('mb.volume')} value={p.volume} min={0} max={100} display={String(p.volume)} disabled={p.disabled} onChange={p.onVolume} />
        </section>
      </div>
    </div>
  );
}
