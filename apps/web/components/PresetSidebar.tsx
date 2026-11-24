'use client';

import { useMemo, useState } from 'react';
import { presetLabel, USER_PRESETS } from '@pocket-master/core';
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

type Bank = 'user' | 'factory';

/** Factory / user banks, a search and every preset; loading asks first over unsaved changes. */
export function PresetSidebar({ names, current, modified, disabled, onReadNames, onLoad }: Props) {
  const { t } = useI18n();
  const [bank, setBank] = useState<Bank>(current !== null && current >= USER_PRESETS ? 'factory' : 'user');
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  // Phone width only: the list folds behind a button showing the current preset.
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (names ?? [])
      .map((name, i) => ({ i, name, label: presetLabel(i) }))
      .filter((p) => (bank === 'user' ? p.i < USER_PRESETS : p.i >= USER_PRESETS))
      .filter((p) => !f || p.name.toLowerCase().includes(f) || p.label.toLowerCase().includes(f));
  }, [names, filter, bank]);

  const choose = (i: number) => {
    if (i === current) return;
    setOpen(false);
    if (modified) setPending(i);
    else onLoad(i);
  };

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label={t('presets.title')}>
      <button type="button" className="sidebar-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          {t('presets.title')}
          {current !== null ? ` · ${presetLabel(current)} ${names?.[current] ?? ''}` : ''}
        </span>
      </button>
      <div className="segmented sidebar-banks" role="tablist">
        {(['factory', 'user'] as const).map((b) => (
          <button key={b} type="button" role="tab" aria-selected={bank === b} className={bank === b ? 'is-on' : ''} onClick={() => setBank(b)}>
            {t(b === 'user' ? 'presets.user' : 'presets.factory')}
          </button>
        ))}
      </div>
      <input className="sidebar-search" type="search" value={filter} placeholder={t('presets.filter')} aria-label={t('presets.filter')} onChange={(e) => setFilter(e.target.value)} />
      {!names ? (
        <button type="button" className="btn btn-small" disabled={disabled} onClick={onReadNames}>
          {t('presets.read')}
        </button>
      ) : (
        <ul className="sidebar-list">
          {shown.map((p) => (
            <li key={p.i}>
              <button
                type="button"
                className={`sidebar-item${p.i === current ? ' is-current' : ''}`}
                disabled={disabled}
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
      )}
      <Dialog open={pending !== null} title={t('presets.unsavedTitle')} onClose={() => setPending(null)}>
        <p>{t('presets.unsaved', { current: current === null ? '' : presetLabel(current), next: pending === null ? '' : presetLabel(pending) })}</p>
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
