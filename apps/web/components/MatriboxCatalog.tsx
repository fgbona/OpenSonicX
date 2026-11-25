'use client';

import type { MbCatalog } from '@pocket-master/core';
import { MAC_CATALOG_PATH } from '@/lib/matriboxCatalog';
import { FileButton } from './FileButton';
import { useI18n } from './I18n';

interface Props {
  catalog: MbCatalog | null;
  error: string | null;
  onPick: (file: File) => void;
  onForget: () => void;
}

/**
 * The model catalog: the owner's own alg_data.json, picked once and kept in this browser. Missing,
 * it is a panel saying where the file is; loaded, one discreet line under the panels.
 */
export function MatriboxCatalog({ catalog, error, onPick, onForget }: Props) {
  const { t, te } = useI18n();
  const picker = (
    <FileButton
      className={catalog ? 'btn-link' : 'btn btn-primary'}
      accept=".json,application/json"
      pickLabel={t('mb.catalogPick')}
      onPick={(input) => {
        const file = input.files?.[0];
        input.value = '';
        if (file) onPick(file);
      }}
    >
      {t(catalog ? 'mb.catalogReplace' : 'mb.catalogPick')}
    </FileButton>
  );
  const alert = error && (
    <p className="alert" role="alert">
      {te(error)}
    </p>
  );
  if (catalog) {
    const models = catalog.modules.reduce((n, m) => n + m.models.length, 0);
    return (
      <section className="mb-catalog-line" aria-label={t('mb.catalogTitle')}>
        <p className="muted small">
          {t('mb.catalogLoaded', { models })} {picker}
          <button type="button" className="btn-link" onClick={onForget}>
            {t('mb.catalogForget')}
          </button>
        </p>
        {alert}
      </section>
    );
  }
  return (
    <section className="panel mb-catalog" aria-label={t('mb.catalogTitle')}>
      <div className="panel-head">
        <h2>{t('mb.catalogTitle')}</h2>
      </div>
      <div className="mb-body">
        <p>
          <strong>{t('mb.catalogMissing')}</strong>
        </p>
        <p className="muted small">{t('mb.catalogWhere')}</p>
        <code className="mb-path">{MAC_CATALOG_PATH}</code>
        <p className="muted small">{t('mb.catalogPrivate')}</p>
        <div>{picker}</div>
        {alert}
      </div>
    </section>
  );
}
