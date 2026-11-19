'use client';

import { useMemo, useState } from 'react';
import { presetLabel } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { useI18n } from './I18n';

interface Props {
  names: readonly string[] | null;
  current: number | null;
  modified: boolean;
  disabled: boolean;
  onReadNames: () => void;
  onLoad: (index: number) => void;
}

/** Every preset with a filter; loading one asks first when the current one has unsaved changes. */
export function PresetList({ names, current, modified, disabled, onReadNames, onLoad }: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (names ?? []).map((name, i) => ({ i, name, label: presetLabel(i) }))
      .filter((p) => !f || p.name.toLowerCase().includes(f) || p.label.toLowerCase().includes(f));
  }, [names, filter]);

  const choose = (i: number) => {
    if (i === current) return;
    if (modified) setPending(i);
    else onLoad(i);
  };

  return (
    <section className="panel" aria-label={t('presets.title')}>
      <header className="panel-head">
        <h2>{t('presets.title')}</h2>
        {names && <input className="preset-filter" type="search" value={filter} placeholder={t('presets.filter')} aria-label={t('presets.filter')} onChange={(e) => setFilter(e.target.value)} />}
      </header>
      {!names ? (
        <p className="panel-empty"><button type="button" className="btn btn-small" disabled={disabled} onClick={onReadNames}>{t('presets.read')}</button></p>
      ) : (
        <ul className="preset-list">
          {shown.map((p) => (
            <li key={p.i}>
              <button
                type="button"
                className={`preset-item${p.i === current ? ' is-current' : ''}`}
                disabled={disabled}
                aria-current={p.i === current ? 'true' : undefined}
                aria-label={t('presets.loadAria', { label: p.label, name: p.name })}
                onClick={() => choose(p.i)}
              >
                <span className="preset-item-label">{p.label}</span> {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={pending !== null} title={t('presets.unsavedTitle')} onClose={() => setPending(null)}>
        <p>{t('presets.unsaved', { current: current === null ? '' : presetLabel(current), next: pending === null ? '' : presetLabel(pending) })}</p>
        <div className="sheet-actions">
          <button className="btn" onClick={() => setPending(null)}>{t('action.cancel')}</button>
          <button className="btn btn-danger" onClick={() => { if (pending !== null) onLoad(pending); setPending(null); }}>{t('presets.discard')}</button>
        </div>
      </Dialog>
    </section>
  );
}
