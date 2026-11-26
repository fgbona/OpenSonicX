'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MB_CATALOG, mbAssignments, mbPresetLabel, resolveMbPreset, type MbResolvedBlock, type MidiPort } from '@pocket-master/core';
import { ccChannelOf } from '@/lib/matriboxGlobals';
import { mbLookKey } from '@/lib/matriboxLook';
import { useMatribox } from '@/lib/useMatribox';
import { useMatriboxHistory } from '@/lib/useMatriboxHistory';
import { useUndoKeys } from '@/lib/useUndoKeys';
import { MatriboxAssistant } from './MatriboxAssistant';
import { MatriboxBackupAll } from './MatriboxBackupAll';
import { MatriboxBackups } from './MatriboxBackups';
import { MatriboxBlockPanel } from './MatriboxBlockPanel';
import { MatriboxChain } from './MatriboxChain';
import { MatriboxControls } from './MatriboxControls';
import { MatriboxDspLoad } from './MatriboxDspLoad';
import { MatriboxExpression } from './MatriboxExpression';
import { MatriboxFootswitches } from './MatriboxFootswitches';
import { MatriboxGlobals } from './MatriboxGlobals';
import { MatriboxHeader } from './MatriboxHeader';
import { MatriboxLibrary } from './MatriboxLibrary';
import { MatriboxPresetFile } from './MatriboxPresetFile';
import { MatriboxPresets } from './MatriboxPresets';
import { MatriboxQuickKnobs } from './MatriboxQuickKnobs';
import { MatriboxSaveDialog } from './MatriboxSaveDialog';
import { useI18n } from './I18n';

/** The Matribox II Pro editor, shown when the connected pedal is one. */
/** `footer`: shown at the end of the editor (the desktop app's AI connection). */
export function MatriboxEditor({ port, footer }: { port: MidiPort; footer?: ReactNode }) {
  const mb = useMatribox(port);
  const { t, te } = useI18n();
  const history = useMatriboxHistory(mb);
  useUndoKeys(history.undo, history.redo);
  const [saveOpen, setSaveOpen] = useState(false);
  // The assistant's save: the same dialog, filled in; it tells the assistant whether the person saved.
  const [proposal, setProposal] = useState<{ index: number; name: string; resolve: (r: 'saved' | 'cancelled') => void } | null>(null);
  const savedRef = useRef(false);
  const proposeSave = (index: number, name: string) =>
    new Promise<'saved' | 'cancelled'>((resolve) => {
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
  const chain = useMemo(() => (unit ? resolveMbPreset(unit.preset, MB_CATALOG).chain : []), [unit]);
  const assignments = useMemo(() => (unit ? mbAssignments(unit.preset) : null), [unit]);
  const disabled = mb.busy !== null;
  const userSlot = (b: Pick<MbResolvedBlock, 'module' | 'fxid'>) => (b.module === 'IR' ? unit?.irNames : b.module === 'CLONE' ? unit?.cloneNames : undefined)?.[b.fxid & 0xff]?.trim() || undefined;

  // The block the panel edits, by storage slot (a move keeps it). The AMP until one is picked; a block just added is picked.
  const [selected, setSelected] = useState<number | null>(null);
  const seen = useRef<{ current: number; slots: readonly number[] } | null>(null);
  const current = unit?.current;
  const slots = chain.map((b) => b.slot).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: slots is the chain's identity here (which storage slots it uses)
  useEffect(() => {
    if (current === undefined) return;
    const now = chain.map((b) => b.slot);
    const before = seen.current;
    seen.current = { current, slots: now };
    if (!before || before.current !== current) return setSelected(null);
    const added = now.filter((slot) => !before.slots.includes(slot));
    if (added.length === 1 && now.length === before.slots.length + 1) setSelected(added[0] ?? null);
  }, [current, slots]);
  const block = chain.find((b) => b.slot === selected) ?? chain.find((b) => mbLookKey(b) === 'amp') ?? chain[0] ?? null;

  return (
    <div className={unit ? 'layout' : 'layout layout-single'}>
      {unit && <MatriboxPresets names={unit.names} current={unit.current} edited={mb.edited} onLoad={(i) => void mb.select(i)} />}
      <main className="main">
        {mb.error && !saveOpen && (
          <p className="alert" role="alert">
            {te(mb.error)}
          </p>
        )}
        <p className="mb-banner" role="status">
          {t('mb.experimental')}
        </p>
        {!unit || !assignments ? (
          <p className="muted">{t(mb.busy ? 'status.reading' : 'mb.notRead')}</p>
        ) : (
          <>
            <section className="preset" aria-label={t('preset.aria')}>
              <MatriboxHeader
                label={mbPresetLabel(unit.current)}
                name={unit.preset.name}
                style={unit.preset.style.trim()}
                edited={mb.edited}
                volume={assignments.volume}
                disabled={disabled}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onVolume={mb.setVolume}
                onUndo={() => void history.undo()}
                onRedo={() => void history.redo()}
                onRead={() => void mb.refresh()}
                onSave={() => {
                  mb.clearError();
                  setSaveOpen(true);
                }}
                files={
                  <>
                    <MatriboxPresetFile mb={mb} />
                    <MatriboxGlobals mb={mb} />
                  </>
                }
              />
              <MatriboxChain
                chain={chain}
                selected={block?.slot ?? null}
                disabled={disabled}
                userSlot={userSlot}
                onSelect={setSelected}
                onOn={(s, on) => void history.setOn(s, on)}
                onMove={(a, b) => void history.moveBlock(a, b)}
                onAdd={(m, fxid) => void history.addBlock(chain.length, m, fxid)}
              />
              <MatriboxDspLoad chain={chain} overload={mb.overload} onClose={mb.clearOverload} />
              {block && (
                <MatriboxBlockPanel
                  block={block}
                  values={unit.preset.chain.find((b) => b.slot === block.slot)?.values ?? []}
                  userSlot={userSlot}
                  disabled={disabled}
                  onParam={history.setParam}
                  onOn={(s, on) => void history.setOn(s, on)}
                  onModel={(s, m, f) => void history.changeModel(s, m, f)}
                  onRemove={(p) => void history.removeBlock(p)}
                />
              )}
            </section>
            <MatriboxFootswitches
              footswitches={assignments.footswitches}
              ctrl={assignments.ctrl}
              chain={chain}
              disabled={disabled}
              onFunction={(f, fn) => void mb.setFootswitchFunction(f, fn)}
              onCtrl={(c, s, on) => void mb.assignCtrl(c, s, on)}
            />
            <MatriboxQuickKnobs quickKnobs={assignments.quickKnobs} chain={chain} disabled={disabled} onAssign={(k, target, p) => void mb.assignQuickKnob(k, target, p)} />
            <MatriboxExpression expression={assignments.expression} chain={chain} disabled={disabled} onExpression={(a) => void mb.assignExpression(a)} />
            <MatriboxControls tempo={assignments.tempo} unitChannel={ccChannelOf(mb.globals)} onControl={(m) => void mb.control(m)} />
            <MatriboxSaveDialog
              open={saveOpen}
              current={proposal?.index ?? unit.current}
              names={unit.names}
              loadedName={proposal?.name ?? unit.preset.name}
              busy={mb.busy === 'Saving'}
              error={mb.error}
              lastBackup={mb.backups[0] ?? null}
              storageWarning={mb.storageWarning}
              onSave={save}
              onClose={closeSave}
            />
            <MatriboxAssistant mb={mb} history={history} proposeSave={proposeSave} />
            <MatriboxLibrary mb={mb} history={history} />
            <MatriboxBackupAll mb={mb} loaded={mbPresetLabel(unit.current)} />
          </>
        )}
        {mb.backups.length > 0 && <MatriboxBackups backups={mb.backups} />}
        {footer}
      </main>
    </div>
  );
}
