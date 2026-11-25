'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MB_CATALOG, MB_PRESET_COUNT, mbPresetLabel, resolveMbPreset, writeMatriboxPrst, type MbPreset } from '@pocket-master/core';
import { downloadJson, downloadText } from '@/lib/backupStore';
import { mbBackupFileName } from '@/lib/matriboxBackups';
import { MB_PRESET_FILE_ACCEPT, mbPrstFileName, parseMbPresetFile } from '@/lib/matriboxPresetFile';
import type { Matribox } from '@/lib/useMatribox';
import { Dialog } from './Dialog';
import { FileButton } from './FileButton';
import { useI18n } from './I18n';

/** What the import dialog shows: a file that was refused, or a preset waiting for its confirmation. */
type Picked = { readonly file: string; readonly error: string } | { readonly file: string; readonly preset: MbPreset };

/**
 * One preset as a file: *Export preset* downloads the loaded preset (unsaved edits included) as the
 * .prst Sonicake's own app opens; *Import preset…* stores a .prst (or a backup of one slot) in a
 * slot, after an explicit confirmation and a backup of that slot. Two buttons and their dialog.
 */
export function MatriboxPresetFile({ mb }: { mb: Matribox }) {
  const { t, te } = useI18n();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [target, setTarget] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState(false);
  const unit = mb.unit;
  if (!unit) return null;
  const disabled = mb.busy !== null;
  const importing = mb.busy === 'Importing';
  const label = mbPresetLabel(target);

  const exportPreset = async () => {
    const preset = await mb.readEditBuffer();
    if (preset) downloadText(writeMatriboxPrst(preset), mbPrstFileName(mbPresetLabel(unit.current), preset.name), 'application/octet-stream');
  };
  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    mb.clearError();
    setTarget(unit.current);
    setConfirmed(false);
    setDone(false);
    try {
      setPicked({ file: chosen.name, preset: parseMbPresetFile(new Uint8Array(await chosen.arrayBuffer())) });
    } catch (e) {
      setPicked({ file: chosen.name, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const close = () => setPicked(null);
  // The newest backup, when it is the target's: a failure before the backup leaves an older one in front.
  const lastBackup = mb.backups[0]?.index === target ? mb.backups[0] : undefined;
  const backupOffer = lastBackup && (
    <p className="small">
      {mb.storageWarning && <strong>{t('mb.backupNotKept')} </strong>}
      <button type="button" className="btn-link" onClick={() => downloadJson(lastBackup, mbBackupFileName(lastBackup))}>
        {t('mb.backupDownload', { slot: lastBackup.label })}
      </button>
    </p>
  );

  return (
    <>
      <button type="button" className="btn" disabled={disabled} onClick={() => void exportPreset()}>
        {t('mb.exportPreset')}
      </button>
      <FileButton className="btn" accept={MB_PRESET_FILE_ACCEPT} pickLabel={t('mb.importPick')} disabled={disabled} onPick={(input) => void pick(input)}>
        {t('mb.importPreset')}
      </FileButton>
      {/* On <body>: the buttons may sit in the header's folded menu, which hides its box. */}
      {createPortal(
        <Dialog open={picked !== null} title={t('mb.importTitle')} onClose={close} locked={importing}>
          {!picked ? null : 'error' in picked ? (
            <>
              <p className="alert" role="alert">
                {picked.file}: {te(picked.error)}
              </p>
              <div className="sheet-actions">
                <button type="button" className="btn btn-primary" onClick={close}>
                  {t('action.done')}
                </button>
              </div>
            </>
          ) : done ? (
            <>
              <p>{t('mb.imported', { slot: label, name: picked.preset.name })}</p>
              {backupOffer}
              <div className="sheet-actions">
                <button type="button" className="btn btn-primary" onClick={close}>
                  {t('action.done')}
                </button>
              </div>
            </>
          ) : (
            <form
              className="sheet-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (confirmed && (await mb.importPreset(target, picked.preset))) setDone(true);
              }}
            >
              <div className="sheet-note">
                <p>
                  <strong>{t('mb.importHolds', { name: picked.preset.name, file: picked.file })}</strong>
                </p>
                <p>
                  {t('mb.chain')}:{' '}
                  {resolveMbPreset(picked.preset, MB_CATALOG)
                    .chain.map((b) => (b.model ? `${b.module} ${b.model.name}` : b.module))
                    .join(' → ') || t('mb.empty')}
                </p>
              </div>
              <label className="field">
                <span>{t('save.slot')}</span>
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(Number(e.target.value));
                    setConfirmed(false);
                  }}
                  disabled={importing}
                >
                  {Array.from({ length: MB_PRESET_COUNT }, (_, i) => (
                    <option key={i} value={i}>
                      {mbPresetLabel(i)} · {unit.names[i]?.name ?? ''}
                      {i === unit.current ? ` ${t('save.loaded')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {mb.edited && <p className="small">{t('mb.importEdited', { slot: mbPresetLabel(unit.current) })}</p>}
              <label className="mb-confirm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={importing} />
                <span>{t('mb.importConfirm', { slot: label, name: unit.names[target]?.name ?? '' })}</span>
              </label>
              {mb.error && (
                <p className="alert" role="alert">
                  {te(mb.error)}
                </p>
              )}
              {mb.error && backupOffer}
              <div className="sheet-actions">
                <button type="button" className="btn" onClick={close} disabled={importing}>
                  {t('action.cancel')}
                </button>
                <button type="submit" className="btn btn-danger" disabled={importing || !confirmed}>
                  {t(importing ? 'mb.importing' : 'mb.importSubmit', { slot: label })}
                </button>
              </div>
            </form>
          )}
        </Dialog>,
        document.body,
      )}
    </>
  );
}
