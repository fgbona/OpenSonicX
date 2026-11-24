'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BackupsPanel } from '@/components/BackupsPanel';
import { ChainView } from '@/components/ChainView';
import { SaveDialog } from '@/components/SaveDialog';
import { CopyDialog } from '@/components/CopyDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { PresetFiles } from '@/components/PresetFiles';
import { PresetLibrary } from '@/components/PresetLibrary';
import { addToLibrary } from '@/lib/presetLibrary';
import { PEDAL_NAMES, presetLabel, TESTED_FIRMWARE, type PresetFile, type ToneHost } from '@pocket-master/core';
import { AssistantPanel } from '@/components/AssistantPanel';
import { pocketMasterAgent } from '@/lib/pocketAgent';
import { useUndoKeys } from '@/lib/useUndoKeys';
import { Dialog } from '@/components/Dialog';
import { PresetSidebar } from '@/components/PresetSidebar';
import { SlotsPanel } from '@/components/SlotsPanel';
import { Tone3000Panel } from '@/components/Tone3000Panel';
import { SysexLog } from '@/components/SysexLog';
import { Toolbar } from '@/components/Toolbar';
import { usePocketMaster } from '@/lib/usePocketMaster';
import { useI18n } from '@/components/I18n';
import { useIsDesktop } from '@/lib/desktop';
import { MatriboxEditor } from '@/components/MatriboxEditor';

const STEPS = ['empty.step1', 'empty.step2'] as const;
const LOG_KEY = 'pocket-master-editor.showLog';
// The desktop app grants MIDI itself: there is no permission to give.
const DESKTOP_STEPS = ['empty.step1'] as const;
const APP_NAME = 'OpenSonicX';

export default function EditorPage() {
  const pm = usePocketMaster();
  const { t, te } = useI18n();
  const desktop = useIsDesktop();
  const [saveOpen, setSaveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  // The SysEx log is a diagnostic tool: hidden unless asked for, and the choice is remembered.
  const [showLog, setShowLog] = useState(false);
  useEffect(() => {
    try {
      setShowLog(localStorage.getItem(LOG_KEY) === '1');
    } catch {
      // storage blocked: the log stays hidden
    }
  }, []);
  const toggleLog = () => {
    const next = !showLog;
    setShowLog(next);
    try {
      localStorage.setItem(LOG_KEY, next ? '1' : '0');
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The tone assistant loads and saves through the same confirmations a person sees.
  const [assistantLoad, setAssistantLoad] = useState<{ index: number; resolve: (loaded: boolean) => void } | null>(null);
  const [proposal, setProposal] = useState<{ target: number; name: string; resolve: (r: 'saved' | 'cancelled') => void } | null>(null);
  const savedRef = useRef(false);
  const { assistantBase, loadPresetNow, loadNames: readNames } = pm;
  const toneHost = useMemo<ToneHost>(
    () => ({
      ...assistantBase,
      selectPreset: async (index) => {
        if (assistantBase.snapshot().modified) {
          const discard = await new Promise<boolean>((resolve) => setAssistantLoad({ index, resolve }));
          if (!discard) return false;
        }
        if (!(await loadPresetNow(index))) throw new Error(`The pedal did not load ${presetLabel(index)}.`);
        return true;
      },
      proposeSave: (target, name) =>
        new Promise((resolve) => {
          savedRef.current = false;
          setProposal({ target, name, resolve });
          setSaveOpen(true);
          void readNames();
        }),
    }),
    [assistantBase, loadPresetNow, readNames],
  );
  const toneAgent = useMemo(() => pocketMasterAgent(toneHost), [toneHost]);
  const closeSave = () => {
    setSaveOpen(false);
    proposal?.resolve(savedRef.current ? 'saved' : 'cancelled');
    setProposal(null);
  };
  // A preset file waiting for the import confirmation, picked from disk or from the library.
  const [importing, setImporting] = useState<PresetFile | null>(null);
  const importPreset = async (file: PresetFile) => {
    const ok = await pm.importPreset(file);
    if (ok) addToLibrary(file);
    return ok;
  };
  const linked = pm.status === 'connected' || pm.status === 'reading';
  // The Matribox II Pro has its own editor; everything below is the Pocket Master's.
  const matribox = linked && pm.pedal === 'matribox' ? pm.matribox : null;
  const connected = linked && !matribox;
  // The Matribox editor has its own Undo (MatriboxEditor).
  useUndoKeys(pm.undo, pm.redo, !matribox);
  // The window (and the desktop app's title bar) names the connected pedal.
  const pedalName = linked && pm.pedal ? PEDAL_NAMES[pm.pedal] : null;
  // The sidebar lists every preset: read the names once the pedal is connected.
  const { names, loadNames } = pm;
  useEffect(() => {
    if (connected && names === null) void loadNames();
  }, [connected, names, loadNames]);
  return (
    <>
      {/* React puts it in the head; layout.tsx sets no title of its own, so this one wins. */}
      <title>{pedalName ? `${APP_NAME} · ${pedalName}` : APP_NAME}</title>
      <Toolbar
        status={pm.status}
        transport={pm.transport}
        pedal={pm.pedal}
        midiRefused={pm.midiRefused}
        onEnable={() => void pm.enable()}
        onRead={pm.read}
        modified={pm.modified}
        onRevert={pm.revert}
        onUndo={pm.undo}
        onRedo={pm.redo}
        canUndo={pm.canUndo}
        canRedo={pm.canRedo}
        onSave={() => {
          pm.clearError();
          setSaveOpen(true);
          void pm.loadNames();
        }}
        onCopy={() => {
          pm.clearError();
          setCopyOpen(true);
          void pm.loadNames();
        }}
        tuner={pm.tuner}
        onTuner={pm.setTuner}
        busy={pm.busy !== null}
        canSave={pm.preset !== null}
        onSettings={() => {
          pm.clearError();
          setSettingsOpen(true);
        }}
        onBluetooth={pm.connectBle}
        matribox={matribox !== null}
      />
      <SettingsDialog
        open={settingsOpen}
        firmware={pm.firmware}
        onClose={() => setSettingsOpen(false)}
        exclusive={pm.exclusive}
        writeGlobal={pm.writeGlobal}
        busy={pm.busy !== null}
        error={pm.error}
        factoryReset={pm.factoryReset}
        onReset={pm.reconnect}
      />
      {matribox ? (
        <>
          {pm.error && (
            <p className="alert" role="alert">
              {te(pm.error)}
            </p>
          )}
          <MatriboxEditor port={matribox} desktop={desktop} />
        </>
      ) : (
        <div className={connected ? 'layout' : 'layout layout-single'}>
          {connected && <PresetSidebar names={pm.names} current={pm.presetIndex} modified={pm.modified} disabled={pm.busy !== null} onReadNames={() => void pm.loadNames()} onLoad={pm.loadPreset} />}
          <main className="main">
            {pm.error && (
              <p className="alert" role="alert">
                {te(pm.error)}
              </p>
            )}
            {connected && pm.firmware && pm.firmware !== TESTED_FIRMWARE && (
              <p className="notice" role="status">
                {t('firmware.untested', { firmware: pm.firmware, tested: TESTED_FIRMWARE })}
              </p>
            )}
            {pm.preset && (
              <PresetFiles
                connected={connected}
                current={pm.preset}
                busy={pm.busy}
                error={pm.error}
                pending={importing}
                onPick={setImporting}
                onExport={pm.exportPreset}
                onImport={importPreset}
                onError={pm.showError}
              />
            )}
            {pm.preset ? (
              <ChainView
                preset={pm.preset}
                presetIndex={pm.presetIndex}
                presetName={pm.presetIndex !== null ? (pm.names?.[pm.presetIndex] ?? null) : null}
                editable={pm.busy === null}
                modified={pm.modified}
                onEdit={pm.edit}
                irNames={pm.irNames}
                profileNames={pm.profileNames}
              />
            ) : (
              <section className="empty">
                <h1>{t('empty.title')}</h1>
                <p className="muted">{t('empty.subtitle')}</p>
                <ol className="steps">
                  {(desktop ? DESKTOP_STEPS : STEPS).map((s) => (
                    <li key={s}>{t(s)}</li>
                  ))}
                </ol>
                <p className="muted small">{t(desktop ? 'empty.desktopNote' : 'empty.browsers')}</p>
                <p className="muted small">{t('empty.firmware')}</p>
              </section>
            )}
            {connected && (
              <>
                {pm.preset && <AssistantPanel agent={toneAgent} />}
                <Tone3000Panel connected={connected} busy={pm.busy !== null} irNames={pm.irNames} profileNames={pm.profileNames} exclusive={pm.exclusive} error={pm.error} />
                <SlotsPanel connected={connected} busy={pm.busy !== null} irNames={pm.irNames} profileNames={pm.profileNames} exclusive={pm.exclusive} error={pm.error} />
              </>
            )}
            {connected && (
              <PresetLibrary
                disabled={pm.busy !== null || !pm.preset}
                onLoad={(file) => {
                  pm.clearError();
                  setImporting(file);
                }}
              />
            )}
            <BackupsPanel
              backups={pm.backups}
              connected={connected}
              busy={pm.busy}
              error={pm.error}
              flowBackups={pm.flowBackups}
              storageWarning={pm.storageWarning}
              onDownload={pm.downloadBackup}
              onImport={pm.importBackup}
              onDelete={pm.deleteBackup}
              onPreset={(file) => {
                pm.clearError();
                setImporting(file);
              }}
              onRestore={pm.restore}
              onBackupAll={pm.backupAll}
              onRestoreAll={pm.restoreAll}
            />
            {showLog && <SysexLog log={pm.log} onClear={pm.clearLog} />}
            <p className="page-tools">
              <button type="button" className="btn-link" onClick={toggleLog}>
                {t(showLog ? 'log.hide' : 'log.show')}
              </button>
            </p>
            <Dialog
              open={assistantLoad !== null}
              title={t('presets.unsavedTitle')}
              onClose={() => {
                assistantLoad?.resolve(false);
                setAssistantLoad(null);
              }}
            >
              <p>{t('presets.unsaved', { current: pm.presetIndex === null ? '' : presetLabel(pm.presetIndex), next: assistantLoad ? presetLabel(assistantLoad.index) : '' })}</p>
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    assistantLoad?.resolve(false);
                    setAssistantLoad(null);
                  }}
                >
                  {t('action.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    assistantLoad?.resolve(true);
                    setAssistantLoad(null);
                  }}
                >
                  {t('presets.discard')}
                </button>
              </div>
            </Dialog>
            <CopyDialog open={copyOpen} presetIndex={pm.presetIndex} names={pm.names} busy={pm.busy} error={pm.error} onCopy={pm.copyPreset} onClose={() => setCopyOpen(false)} />
            <SaveDialog
              open={saveOpen}
              presetIndex={pm.presetIndex}
              names={pm.names}
              busy={pm.busy}
              error={pm.error}
              flowBackups={pm.flowBackups}
              storageWarning={pm.storageWarning}
              onDownload={pm.downloadBackup}
              onSave={pm.save}
              onClose={closeSave}
              proposal={proposal}
              onSaved={() => {
                savedRef.current = true;
              }}
            />
          </main>
        </div>
      )}
    </>
  );
}
