'use client';

import type { MbCatalog } from '@pocket-master/core';
import { MAC_CATALOG_PATH } from '@/lib/matriboxCatalog';
import { useI18n } from './I18n';

interface Props {
  catalog: MbCatalog | null;
  error: string | null;
  onPick: (file: File) => void;
  onForget: () => void;
}

/** The model catalog: the owner's own alg_data.json, picked once and kept in this browser. */
export function MatriboxCatalog({ catalog, error, onPick, onForget }: Props) {
  const { t, te } = useI18n();
  const picker = (
    <label className="btn btn-small">
      {t(catalog ? 'mb.catalogReplace' : 'mb.catalogPick')}
      <input
        type="file"
        accept=".json,application/json"
        hidden
        aria-label={t('mb.catalogPick')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </label>
  );
  const models = catalog?.modules.reduce((n, m) => n + m.models.length, 0) ?? 0;
  return (
    <section className={catalog ? 'mb-catalog' : 'notice mb-catalog'} aria-label={t('mb.catalogTitle')}>
      {catalog ? (
        <p className="small">
          {t('mb.catalogLoaded', { models })} {picker}{' '}
          <button type="button" className="btn-link" onClick={onForget}>
            {t('mb.catalogForget')}
          </button>
        </p>
      ) : (
        <>
          <p>
            <strong>{t('mb.catalogMissing')}</strong>
          </p>
          <p className="small">{t('mb.catalogWhere')}</p>
          <p className="small">
            <code className="mb-path">{MAC_CATALOG_PATH}</code>
          </p>
          <p className="small">{t('mb.catalogPrivate')}</p>
          {picker}
        </>
      )}
      {error && (
        <p className="alert" role="alert">
          {te(error)}
        </p>
      )}
    </section>
  );
}
