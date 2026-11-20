'use client';

import { useState } from 'react';
import { renameUserIr, renameUserProfile } from '@pocket-master/core';
import { Dialog } from './Dialog';
import { InstallDialog } from './InstallDialog';
import { useI18n } from './I18n';
import { NAME_MAX, type Exclusive, type InstallSource, type SlotKind } from '@/lib/install';
import { NOTE_MAX, noteFor, setSlotNote, useSlotNotes } from '@/lib/slotNotes';

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
  const [renaming, setRenaming] = useState<{ kind: SlotKind; slot: number; name: string } | null>(null);
  const [renameTried, setRenameTried] = useState(false);
  const notes = useSlotNotes();
  const [noting, setNoting] = useState<{ kind: SlotKind; slot: number; name: string; text: string } | null>(null);

  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const run = renaming.kind === 'ir' ? renameUserIr : renameUserProfile;
    setRenameTried(true);
    const ok = await exclusive('Renaming', (link) => run(link, renaming.slot, name));
    if (ok !== null) setRenaming(null); // a failure stays open with the hook's error below
  };
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
        <li key={i} className={names?.[i] ? 'slot' : 'slot muted'}>
          <span className="slot-text">
            <span><span className="slot-n">{i + 1}</span> {names?.[i] ?? t('slots.empty')}</span>
            {noteFor(notes, kind, i, names?.[i]) && <span className="slot-note">{noteFor(notes, kind, i, names?.[i])}</span>}
          </span>
          {names?.[i] && (
            <span className="slot-buttons">
              <button type="button" className="btn btn-small slot-rename" onClick={() => setNoting({ kind, slot: i, name: names[i]!, text: noteFor(notes, kind, i, names[i]) ?? '' })}>
                {t('slots.note')}
              </button>
              <button type="button" className="btn btn-small slot-rename" disabled={disabled} onClick={() => { setRenameTried(false); setRenaming({ kind, slot: i, name: names[i]! }); }}>
                {t('slots.rename')}
              </button>
            </span>
          )}
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
      <Dialog open={renaming !== null} title={t('slots.renameTitle')} onClose={() => setRenaming(null)} locked={busy}>
        {renaming && (
          <>
            <label className="field">
              {t('install.name')}
              <input value={renaming.name} maxLength={NAME_MAX[renaming.kind]} onChange={(e) => setRenaming({ ...renaming, name: e.target.value.replace(/[^\x20-\x7e]/g, '') })} />
            </label>
            {renameTried && !busy && error && <p className="alert" role="alert">{error}</p>}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setRenaming(null)} disabled={busy}>{t('action.cancel')}</button>
              <button className="btn btn-primary" onClick={() => void rename()} disabled={busy || renaming.name.trim() === ''}>{t('slots.renameSubmit')}</button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog open={noting !== null} title={noting ? t('slots.noteTitle', { name: noting.name }) : ''} onClose={() => setNoting(null)}>
        {noting && (
          <form className="sheet-form" onSubmit={(e) => { e.preventDefault(); setSlotNote(noting.kind, noting.slot, noting.name, noting.text); setNoting(null); }}>
            <label className="field">
              {t('slots.note')}
              <input value={noting.text} maxLength={NOTE_MAX} placeholder={t('slots.notePlaceholder')} autoFocus onChange={(e) => setNoting({ ...noting, text: e.target.value })} />
            </label>
            <p className="muted small">{t('slots.noteHint')}</p>
            <div className="sheet-actions">
              <button type="button" className="btn" onClick={() => setNoting(null)}>{t('action.cancel')}</button>
              <button type="submit" className="btn btn-primary">{t('slots.noteSave')}</button>
            </div>
          </form>
        )}
      </Dialog>
      <InstallDialog sources={sources} irNames={irNames} profileNames={profileNames} exclusive={exclusive} error={error} onClose={() => setSources(null)} />
    </section>
  );
}
