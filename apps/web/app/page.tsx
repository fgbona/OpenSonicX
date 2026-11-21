'use client';

import { useEffect, useState } from 'react';
import { BackupsPanel } from '@/components/BackupsPanel';
import { ChainView } from '@/components/ChainView';
import { SaveDialog } from '@/components/SaveDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { PresetFiles } from '@/components/PresetFiles';
import { PresetLibrary } from '@/components/PresetLibrary';
import { addToLibrary } from '@/lib/presetLibrary';
import { TESTED_FIRMWARE, type PresetFile } from '@pocket-master/core';
import { PresetSidebar } from '@/components/PresetSidebar';
import { SlotsPanel } from '@/components/SlotsPanel';
import { Tone3000Panel } from '@/components/Tone3000Panel';
import { SysexLog } from '@/components/SysexLog';
import { Toolbar } from '@/components/Toolbar';
import { usePocketMaster } from '@/lib/usePocketMaster';
import { useI18n } from '@/components/I18n';
import { useIsDesktop } from '@/lib/desktop';

const STEPS = ['empty.step1', 'empty.step2', 'empty.step3'] as const;
const LOG_KEY = 'pocket-master-editor.showLog';
// The desktop app grants MIDI itself and has no browser to pick.
const DESKTOP_STEPS = ['empty.step1', 'empty.desktopStep2'] as const;

export default function EditorPage() {
  const pm = usePocketMaster();
  const { t, te } = useI18n();
  const desktop = useIsDesktop();
  const [saveOpen, setSaveOpen] = useState(false);
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
  // A preset file waiting for the import confirmation, picked from disk or from the library.
  const [importing, setImporting] = useState<PresetFile | null>(null);
  const importPreset = async (file: PresetFile) => {
    const ok = await pm.importPreset(file);
    if (ok) addToLibrary(file);
    return ok;
  };
  // ⌘Z / Ctrl+Z undoes a live edit, ⇧⌘Z / Ctrl+Y redoes; text fields keep their own undo.
  const { undo, redo } = pm;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  const connected = pm.status === 'connected' || pm.status === 'reading';
  // The sidebar lists every preset: read the names once the pedal is connected.
  const { names, loadNames } = pm;
  useEffect(() => {
    if (connected && names === null) void loadNames();
  }, [connected, names, loadNames]);
  return (
    <>
      <Toolbar
        status={pm.status}
        inputs={pm.inputs}
        outputs={pm.outputs}
        inputId={pm.inputId}
        outputId={pm.outputId}
        onSelectInput={pm.selectInput}
        onSelectOutput={pm.selectOutput}
        onEnable={pm.enable}
        onConnect={pm.connect}
        onDisconnect={pm.disconnect}
        onRead={pm.read}
        liveEdit={pm.liveEdit}
        modified={pm.modified}
        onLiveEdit={pm.setLiveEdit}
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
        busy={pm.busy !== null}
        canSave={pm.preset !== null}
        onSettings={() => { pm.clearError(); setSettingsOpen(true); }}
        onBluetooth={pm.connectBle}
      />
      <SettingsDialog open={settingsOpen} firmware={pm.firmware} onClose={() => setSettingsOpen(false)} exclusive={pm.exclusive} writeGlobal={pm.writeGlobal}
        busy={pm.busy !== null} error={pm.error} factoryReset={pm.factoryReset} onReset={pm.disconnect} />
      <div className={connected ? 'layout' : 'layout layout-single'}>
      {connected && (
        <PresetSidebar names={pm.names} current={pm.presetIndex} modified={pm.modified} disabled={pm.busy !== null} onReadNames={() => void pm.loadNames()} onLoad={pm.loadPreset} />
      )}
      <main className="main">
        {pm.error && <p className="alert" role="alert">{te(pm.error)}</p>}
        {connected && pm.firmware && pm.firmware !== TESTED_FIRMWARE && (
          <p className="notice" role="status">{t('firmware.untested', { firmware: pm.firmware, tested: TESTED_FIRMWARE })}</p>
        )}
        {pm.liveEdit && (
          <p className="notice" role="status">
            {t('live.notice')}
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
          <ChainView preset={pm.preset} presetIndex={pm.presetIndex} presetName={pm.presetIndex !== null ? (pm.names?.[pm.presetIndex] ?? null) : null}
            editable={pm.liveEdit && pm.busy === null} modified={pm.modified} onEdit={pm.edit} irNames={pm.irNames} profileNames={pm.profileNames} />
        ) : (
          <section className="empty">
            <h1>{t('empty.title')}</h1>
            <p className="muted">{t('empty.subtitle')}</p>
            <ol className="steps">{(desktop ? DESKTOP_STEPS : STEPS).map((s) => <li key={s}>{t(s)}</li>)}</ol>
            <p className="muted small">{t(desktop ? 'empty.desktopNote' : 'empty.browsers')}</p>
            <p className="muted small">{t('empty.firmware')}</p>
          </section>
        )}
        {connected && (
          <>
            <Tone3000Panel connected={connected} busy={pm.busy !== null} irNames={pm.irNames} profileNames={pm.profileNames} exclusive={pm.exclusive} error={pm.error} />
            <SlotsPanel connected={connected} busy={pm.busy !== null} irNames={pm.irNames} profileNames={pm.profileNames} exclusive={pm.exclusive} error={pm.error} />
          </>
        )}
        {connected && <PresetLibrary disabled={pm.busy !== null || !pm.preset} onLoad={(file) => { pm.clearError(); setImporting(file); }} />}
        <BackupsPanel
          backups={pm.backups}
          connected={connected}
          busy={pm.busy}
          error={pm.error}
          flowBackups={pm.flowBackups}
          storageWarning={pm.storageWarning}
          onDownload={pm.downloadBackup}
          onImport={pm.importBackup}
          onRestore={pm.restore}
          onError={pm.showError}
        />
        {showLog && <SysexLog log={pm.log} onClear={pm.clearLog} />}
        <p className="page-tools"><button type="button" className="btn-link" onClick={toggleLog}>{t(showLog ? 'log.hide' : 'log.show')}</button></p>
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
          onClose={() => setSaveOpen(false)}
        />
      </main>
      </div>
    </>
  );
}
