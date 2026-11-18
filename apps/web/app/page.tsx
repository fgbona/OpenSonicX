'use client';

import { useState } from 'react';
import { BackupsPanel } from '@/components/BackupsPanel';
import { ChainView } from '@/components/ChainView';
import { SaveDialog } from '@/components/SaveDialog';
import { PresetFiles } from '@/components/PresetFiles';
import { SysexLog } from '@/components/SysexLog';
import { Toolbar } from '@/components/Toolbar';
import { usePocketMaster } from '@/lib/usePocketMaster';
import { useI18n } from '@/components/I18n';

const STEPS = ['empty.step1', 'empty.step2', 'empty.step3'] as const;

export default function EditorPage() {
  const pm = usePocketMaster();
  const { t, te } = useI18n();
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
        canSave={pm.preset !== null}
      />
      <main className="main">
        {pm.error && <p className="alert" role="alert">{te(pm.error)}</p>}
        {pm.liveEdit && (
          <p className="notice" role="status">
            {t('live.notice')}
          </p>
        )}
        {pm.preset && (
          <PresetFiles
            connected={connected}
            busy={pm.busy}
            error={pm.error}
            onExport={pm.exportPreset}
            onImport={pm.importPreset}
            onError={pm.showError}
          />
        )}
        {pm.preset ? (
          <ChainView preset={pm.preset} presetIndex={pm.presetIndex} editable={pm.liveEdit && pm.busy === null} modified={pm.modified} onEdit={pm.edit} />
        ) : (
          <section className="empty">
            <h1>{t('empty.title')}</h1>
            <p className="muted">{t('empty.subtitle')}</p>
            <ol className="steps">{STEPS.map((s) => <li key={s}>{t(s)}</li>)}</ol>
            <p className="muted small">{t('empty.browsers')}</p>
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
