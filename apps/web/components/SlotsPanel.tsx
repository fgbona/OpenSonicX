'use client';

import { useState } from 'react';
import { InstallDialog } from './InstallDialog';
import { useI18n } from './I18n';
import type { Exclusive, InstallSource, SlotKind } from '@/lib/install';

interface Props {
  connected: boolean;
  busy: boolean;
  irNames: readonly (string | null)[] | null;
  profileNames: readonly (string | null)[] | null;
  exclusive: Exclusive;
  error: string | null;
}

/** The pedal's captured-profile and user IR slots, with loading from a local .nam or WAV. */
export function SlotsPanel({ connected, busy, irNames, profileNames, exclusive, error }: Props) {
  const { t } = useI18n();
  const [sources, setSources] = useState<InstallSource[] | null>(null);
  const disabled = !connected || busy;

  const pick = (input: HTMLInputElement, kind: SlotKind) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setSources([{ kind, label: file.name, name: file.name, load: async () => new Uint8Array(await file.arrayBuffer()) }]);
  };

  const list = (kind: SlotKind, names: readonly (string | null)[] | null) => (
    <ol className="slots">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className={names?.[i] ? '' : 'muted'}>
          <span className="slot-n">{i + 1}</span> {names?.[i] ?? t('slots.empty')}
        </li>
      ))}
    </ol>
  );

  return (
    <section className="panel" aria-label={t('slots.title')}>
      <header className="panel-head"><h2>{t('slots.title')}</h2></header>
      <div className="slots-grid">
        <div>
          <div className="slots-head">
            <h3>{t('slots.profiles')}</h3>
            <label className={`btn btn-small file-button${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled}>
              {t('slots.loadNam')}
              <input type="file" accept=".nam,application/json" disabled={disabled} onChange={(e) => pick(e.currentTarget, 'profile')} />
            </label>
          </div>
          {list('profile', profileNames)}
        </div>
        <div>
          <div className="slots-head">
            <h3>{t('slots.irs')}</h3>
            <label className={`btn btn-small file-button${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled}>
              {t('slots.loadWav')}
              <input type="file" accept=".wav,audio/wav" disabled={disabled} onChange={(e) => pick(e.currentTarget, 'ir')} />
            </label>
          </div>
          {list('ir', irNames)}
        </div>
      </div>
      <InstallDialog sources={sources} irNames={irNames} profileNames={profileNames} exclusive={exclusive} error={error} onClose={() => setSources(null)} />
    </section>
  );
}
