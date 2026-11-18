'use client';

import { useState } from 'react';
import { BackupsPanel } from '@/components/BackupsPanel';
import { ChainView } from '@/components/ChainView';
import { SaveDialog } from '@/components/SaveDialog';
import { SysexLog } from '@/components/SysexLog';
import { Toolbar } from '@/components/Toolbar';
import { usePocketMaster } from '@/lib/usePocketMaster';

const STEPS = [
  'Connect the Pocket Master by USB and switch it on.',
  'Click Enable MIDI and allow MIDI device access.',
  'Pick the Pocket Master ports and click Connect.',
];

export default function EditorPage() {
  const pm = usePocketMaster();
  const [saveOpen, setSaveOpen] = useState(false);
  const connected = pm.status === 'connected' || pm.status === 'reading';
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
        onSave={() => {
          pm.clearError();
          setSaveOpen(true);
          void pm.loadNames();
        }}
        busy={pm.busy !== null}
      />
      <main className="main">
        {pm.error && <p className="alert" role="alert">{pm.error}</p>}
        {pm.liveEdit && (
          <p className="notice" role="status">
            Live edit is on. Every change goes to the pedal at once, in its edit buffer only. Nothing is saved to a
            preset slot. Revert re-reads the pedal and brings back this preset as it was first read.
          </p>
        )}
        {pm.preset ? (
          <ChainView preset={pm.preset} presetIndex={pm.presetIndex} editable={pm.liveEdit && pm.busy === null} modified={pm.modified} onEdit={pm.edit} />
        ) : (
          <section className="empty">
            <h1>Read your Pocket Master</h1>
            <p className="muted">Read the edit buffer, then turn on Live edit to change the sound from here.</p>
            <ol className="steps">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="muted small">Works in Chrome, Edge and Opera on desktop.</p>
          </section>
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
          onRestore={pm.restore}
          onError={pm.showError}
        />
        <SysexLog log={pm.log} onClear={pm.clearLog} />
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
    </>
  );
}
