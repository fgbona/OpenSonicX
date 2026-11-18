'use client';

import { ChainView } from '@/components/ChainView';
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
      />
      <main className="main">
        {pm.error && <p className="alert" role="alert">{pm.error}</p>}
        {pm.liveEdit && (
          <p className="notice" role="status">
            Live edit is on. Every change goes to the pedal at once, in its edit buffer only. Nothing is saved to a
            preset slot. Revert brings back what was read when you connected.
          </p>
        )}
        {pm.preset ? (
          <ChainView preset={pm.preset} presetIndex={pm.presetIndex} editable={pm.liveEdit} modified={pm.modified} onEdit={pm.edit} />
        ) : (
          <section className="empty">
            <h1>Read your Pocket Master</h1>
            <p className="muted">Read the edit buffer, then turn on Live edit to change the sound from here.</p>
            <ol className="steps">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="muted small">Works in Chrome, Edge and Opera on desktop.</p>
          </section>
        )}
        <SysexLog log={pm.log} onClear={pm.clearLog} />
      </main>
    </>
  );
}
