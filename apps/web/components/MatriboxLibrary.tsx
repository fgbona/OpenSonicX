'use client';

import { useState } from 'react';
import { downloadJson } from '@/lib/backupStore';
import { importMbTones, keepMbTone, mbLibraryFile, mbTone, parseMbLibraryFile, removeMbTone, renameMbTone, tonePreset, useMbLibrary, type MbTone } from '@/lib/matriboxLibrary';
import type { Matribox } from '@/lib/useMatribox';
import type { MatriboxHistory } from '@/lib/useMatriboxHistory';
import { when } from './BackupsPanel';
import { Fold } from './Fold';
import { useI18n } from './I18n';

/** A line under the form: what the last action did, or why it could not. */
type Note = { readonly kind: 'status' | 'alert'; readonly text: string } | null;

/**
 * Tones kept in this browser: *Keep* stores the edit buffer under a name and a note; *Load* sends a
 * kept tone's chain to the edit buffer as one Undo step (never to a slot); rename, delete, and the
 * whole library as one JSON file to carry to another browser.
 */
export function MatriboxLibrary({ mb, history }: { mb: Matribox; history: MatriboxHistory }) {
  const { t, lang } = useI18n();
  const library = useMbLibrary();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [renaming, setRenaming] = useState<{ createdAt: string; name: string } | null>(null);
  const [note, setNote] = useState<Note>(null);
  const disabled = mb.busy !== null;
  const loadedName = mb.unit?.preset.name.trim() ?? '';
  const canLoad = !disabled;

  const keep = async () => {
    const preset = await mb.readEditBuffer();
    if (!preset) return; // the error shows above the chain
    const kept = mbTone(preset, name.trim() || loadedName || t('presetFile.unnamed'), notes);
    keepMbTone(kept);
    // Cleared only if not typed into during the read: that is the next tone's name.
    setName((now) => (now === name ? '' : now));
    setNotes((now) => (now === notes ? '' : now));
    setNote({ kind: 'status', text: t('mbLib.kept', { name: kept.name }) });
  };
  const load = async (tone: MbTone) => {
    mb.clearError();
    try {
      await history.applyChain(tonePreset(tone).chain);
      setNote({ kind: 'status', text: t('mbLib.loaded', { name: tone.name }) });
    } catch (e) {
      console.error('Matribox: could not load the kept tone', e);
      setNote({ kind: 'alert', text: t('mbLib.loadFailed', { name: tone.name }) });
    }
  };
  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    try {
      const tones = parseMbLibraryFile(await chosen.text());
      importMbTones(tones);
      setNote({ kind: 'status', text: t('mbLib.imported', { count: tones.length, file: chosen.name }) });
    } catch {
      setNote({ kind: 'alert', text: t('mbLib.notFile', { file: chosen.name }) });
    }
  };
  const rename = () => {
    if (renaming) renameMbTone(renaming.createdAt, renaming.name);
    setRenaming(null);
  };

  return (
    <Fold title={t('mbLib.title')} note={String(library.length)}>
      <div className="mb-body">
        <p className="muted small">{t('mbLib.note')}</p>
        <form
          className="mb-lib-keep"
          onSubmit={(e) => {
            e.preventDefault();
            void keep();
          }}
        >
          <label className="field">
            <span>{t('mbLib.name')}</span>
            <input value={name} placeholder={loadedName} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('mbLib.notes')}</span>
            <input value={notes} placeholder={t('mbLib.notesHint')} maxLength={120} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            {t('mbLib.keep')}
          </button>
        </form>
        <div className="mb-head-actions">
          <button type="button" className="btn" disabled={library.length === 0} onClick={() => downloadJson(mbLibraryFile(library), 'matribox-library.json')}>
            {t('mbLib.export')}
          </button>
          <label className="btn">
            {t('mbLib.import')}
            <input type="file" hidden accept=".json,application/json" aria-label={t('mbLib.importPick')} onChange={(e) => void pick(e.currentTarget)} />
          </label>
        </div>
        {note && (
          <p className={note.kind === 'alert' ? 'alert' : 'small'} role={note.kind}>
            {note.text}
          </p>
        )}
      </div>
      {library.length === 0 ? (
        <p className="muted small panel-empty">{t('mbLib.empty')}</p>
      ) : (
        <ul className="library mb-library" aria-label={t('mbLib.title')}>
          {library.map((tone) =>
            renaming?.createdAt === tone.createdAt ? (
              <li key={tone.createdAt}>
                <form
                  className="mb-lib-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename();
                  }}
                >
                  <input
                    value={renaming.name}
                    maxLength={40}
                    aria-label={t('mbLib.renameField', { name: tone.name })}
                    // biome-ignore lint/a11y/noAutofocus: the field the person just asked for
                    autoFocus
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                  <button type="submit" className="btn btn-small btn-primary" disabled={!renaming.name.trim()}>
                    {t('mbLib.renameDone')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => setRenaming(null)}>
                    {t('action.cancel')}
                  </button>
                </form>
              </li>
            ) : (
              <li key={tone.createdAt}>
                <span className="library-name">
                  {tone.name}
                  {tone.notes ? <span className="muted small"> · {tone.notes}</span> : null}
                </span>
                <span className="muted small">{when(tone.createdAt, lang)}</span>
                <button type="button" className="btn btn-small" disabled={!canLoad} onClick={() => void load(tone)} aria-label={t('mbLib.loadAria', { name: tone.name })}>
                  {t('mbLib.load')}
                </button>
                <button type="button" className="btn btn-small" onClick={() => setRenaming({ createdAt: tone.createdAt, name: tone.name })} aria-label={t('mbLib.renameAria', { name: tone.name })}>
                  {t('mbLib.rename')}
                </button>
                <button type="button" className="btn btn-small" onClick={() => removeMbTone(tone.createdAt)} aria-label={t('mbLib.removeAria', { name: tone.name })}>
                  {t('mbLib.remove')}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Fold>
  );
}
