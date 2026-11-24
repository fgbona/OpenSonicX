'use client';

import { useMemo, useState } from 'react';
import { mbPresetLabel, type MbPresetName } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { useI18n } from './I18n';

interface Props {
  names: readonly MbPresetName[];
  current: number;
  edited: boolean;
  onLoad: (index: number) => void;
}

/**
 * The Matribox's 240 presets (1A..60D) with a search; loading asks first over unsaved edits. Never
 * disabled: a load waits in the editor's queue behind whatever runs.
 */
export function MatriboxPresets({ names, current, edited, onLoad }: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return names.map((p, i) => ({ i, name: p.name, label: mbPresetLabel(i) })).filter((p) => !f || p.name.toLowerCase().includes(f) || p.label.toLowerCase() === f);
  }, [names, filter]);
  const choose = (i: number) => {
    if (i === current) return;
    if (edited) setPending(i);
    else onLoad(i);
  };
  return (
    <aside className="sidebar mb-sidebar" aria-label={t('presets.title')}>
      <input className="sidebar-search" type="search" value={filter} placeholder={t('presets.filter')} aria-label={t('presets.filter')} onChange={(e) => setFilter(e.target.value)} />
      <ul className="sidebar-list">
        {shown.map((p) => (
          <li key={p.i}>
            <button
              type="button"
              className={`sidebar-item${p.i === current ? ' is-current' : ''}`}
              aria-current={p.i === current ? 'true' : undefined}
              aria-label={t('presets.loadAria', { label: p.label, name: p.name })}
              onClick={() => choose(p.i)}
            >
              <span className="sidebar-badge">{p.label}</span>
              <span className="sidebar-name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={pending !== null} title={t('presets.unsavedTitle')} onClose={() => setPending(null)}>
        <p>{t('presets.unsaved', { current: mbPresetLabel(current), next: pending === null ? '' : mbPresetLabel(pending) })}</p>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => setPending(null)}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (pending !== null) onLoad(pending);
              setPending(null);
            }}
          >
            {t('presets.discard')}
          </button>
        </div>
      </Dialog>
    </aside>
  );
}
