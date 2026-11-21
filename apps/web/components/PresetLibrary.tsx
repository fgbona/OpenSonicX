'use client';

import type { PresetFile } from '@pocket-master/core';
import { removeFromLibrary, usePresetLibrary } from '@/lib/presetLibrary';
import { when } from './BackupsPanel';
import { useI18n } from './I18n';

interface Props {
  disabled: boolean;
  /** Opens the import confirmation, which shows what the preset changes. */
  onLoad: (file: PresetFile) => void;
}

/** Presets exported or imported here, ready to load or compare again. */
export function PresetLibrary({ disabled, onLoad }: Props) {
  const { t, lang } = useI18n();
  const library = usePresetLibrary();
  return (
    <section className="panel" aria-label={t('library.title')}>
      <header className="panel-head">
        <h2>{t('library.title')} <span className="muted">{library.length}</span></h2>
      </header>
      {library.length === 0 ? (
        <p className="muted small panel-empty">{t('library.empty')}</p>
      ) : (
        <ul className="library">
          {library.map((f) => {
            const name = f.name || t('presetFile.unnamed');
            return (
              <li key={`${f.createdAt}-${f.name}`}>
                <span className="library-name">{name}{f.notes ? <span className="muted small"> · {f.notes}</span> : null}</span>
                <span className="muted small">{when(f.createdAt, lang)}</span>
                <button type="button" className="btn btn-small" disabled={disabled} onClick={() => onLoad(f)} aria-label={t('library.loadAria', { name })}>{t('library.load')}</button>
                <button type="button" className="btn btn-small" onClick={() => removeFromLibrary(f)} aria-label={t('library.removeAria', { name })}>{t('library.remove')}</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
