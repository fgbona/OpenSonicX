'use client';

import { useMemo, useRef, useState } from 'react';
import { MB_SLOTS, mbPresetLabel, resolveMbPreset, type MidiPort } from '@pocket-master/core';
import { downloadJson } from '@/lib/backupStore';
import { mbBackupFileName } from '@/lib/matriboxBackups';
import { useMatribox } from '@/lib/useMatribox';
import { useMatriboxHistory } from '@/lib/useMatriboxHistory';
import { useUndoKeys } from '@/lib/useUndoKeys';
import { MatriboxAssistant } from './MatriboxAssistant';
import { MatriboxBlock, MatriboxModelSelect } from './MatriboxBlock';
import { MatriboxCatalog } from './MatriboxCatalog';
import { MatriboxPresets } from './MatriboxPresets';
import { MatriboxSaveDialog } from './MatriboxSaveDialog';
import { useI18n } from './I18n';

/** The Matribox II Pro editor, shown when the connected pedal is one. */
export function MatriboxEditor({ port, desktop }: { port: MidiPort; desktop: boolean }) {
  const mb = useMatribox(port, desktop);
  const { t, te } = useI18n();
  const history = useMatriboxHistory(mb);
  useUndoKeys(history.undo, history.redo);
  const [saveOpen, setSaveOpen] = useState(false);
  // The assistant's save: the same dialog, filled in; it tells the assistant whether the person saved.
  const [proposal, setProposal] = useState<{ index: number; name: string; resolve: (r: 'saved' | 'cancelled') => void } | null>(null);
  const savedRef = useRef(false);
  const proposeSave = (index: number, name: string) => new Promise<'saved' | 'cancelled'>((resolve) => {
    savedRef.current = false;
    mb.clearError();
    setProposal({ index, name, resolve });
    setSaveOpen(true);
  });
  const closeSave = () => {
    setSaveOpen(false);
    proposal?.resolve(savedRef.current ? 'saved' : 'cancelled');
    setProposal(null);
  };
  const save = async (index: number, name: string) => {
    const ok = await mb.save(index, name);
    savedRef.current ||= ok;
    return ok;
  };
  const unit = mb.unit;
  // Without a catalog the chain still shows, by module number and raw fxid.
  const chain = useMemo(() => (unit ? resolveMbPreset(unit.preset, mb.catalog ?? { modules: [] }).chain : []), [unit, mb.catalog]);
  const disabled = mb.busy !== null;
  const userSlot = (module: string, fxid: number) => (module === 'IR' ? unit?.irNames : module === 'CLONE' ? unit?.cloneNames : undefined)?.[fxid & 0xff]?.trim() || undefined;
  return (
    <div className="layout">
      {unit && <MatriboxPresets names={unit.names} current={unit.current} edited={mb.edited} onLoad={(i) => void mb.select(i)} />}
      <main className="main">
        {mb.error && !saveOpen && <p className="alert" role="alert">{te(mb.error)}</p>}
        <p className="notice" role="status">{t('mb.experimental')}</p>
        <MatriboxCatalog catalog={mb.catalog} error={mb.catalogError} onPick={(f) => void mb.pickCatalog(f)} onForget={() => void mb.dropCatalog()} />
        {!unit ? (
          <p className="muted">{t(mb.busy ? 'status.reading' : 'mb.notRead')}</p>
        ) : (
          <>
            <div className="mb-head">
              <h1>{mbPresetLabel(unit.current)} {unit.preset.name}{mb.edited ? ` ${t('mb.edited')}` : ''}</h1>
              <div className="mb-head-actions">
                <button type="button" className="btn" disabled={disabled || !history.canUndo} onClick={() => void history.undo()}>{t('action.undo')}</button>
                <button type="button" className="btn" disabled={disabled || !history.canRedo} onClick={() => void history.redo()}>{t('action.redo')}</button>
                <button type="button" className="btn" disabled={disabled} onClick={() => void mb.refresh()}>{t('action.read')}</button>
                <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => { mb.clearError(); setSaveOpen(true); }}>{t('action.save')}</button>
              </div>
            </div>
            <p className="muted small">{t('mb.chain')}: {chain.map((b) => b.module).join(' → ') || t('mb.empty')}</p>
            <ol className="mb-chain">
              {chain.map((block) => (
                <MatriboxBlock key={`${block.position}-${block.slot}`} block={block} chainLength={chain.length} catalog={mb.catalog} userSlot={userSlot(block.module, block.fxid)}
                  disabled={disabled} onParam={history.setParam} onOn={(s, on) => void history.setOn(s, on)} onModel={(s, m, f) => void history.changeModel(s, m, f)}
                  onMove={(a, b) => void history.moveBlock(a, b)} onRemove={(p) => void history.removeBlock(p)} />
              ))}
            </ol>
            {mb.catalog && chain.length < MB_SLOTS && (
              <p className="mb-add">
                <MatriboxModelSelect catalog={mb.catalog} label={t('mb.addBlock')} value="" disabled={disabled} onChange={(m, fxid) => void history.addBlock(chain.length, m, fxid)} />
              </p>
            )}
            <MatriboxSaveDialog open={saveOpen} current={proposal?.index ?? unit.current} names={unit.names} loadedName={proposal?.name ?? unit.preset.name} busy={mb.busy === 'Saving'} error={mb.error}
              lastBackup={mb.backups[0] ?? null} storageWarning={mb.storageWarning} onSave={save} onClose={closeSave} />
            <MatriboxAssistant mb={mb} history={history} proposeSave={proposeSave} />
          </>
        )}
        {mb.backups.length > 0 && (
          <section className="panel" aria-label={t('mb.backups')}>
            <div className="panel-head"><h2>{t('mb.backups')}</h2></div>
            <ul className="mb-backups">
              {mb.backups.map((b) => (
                <li key={`${b.createdAt}-${b.label}`}>
                  <span>{b.label} {b.name} <span className="muted small">{new Date(b.createdAt).toLocaleString()}</span></span>
                  <button type="button" className="btn btn-small" onClick={() => downloadJson(b, mbBackupFileName(b))}>{t('mb.download')}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
