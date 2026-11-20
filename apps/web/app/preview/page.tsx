'use client';

/**
 * Development preview of the editor screen without a pedal: a stored preset dump (P34, from the
 * core test fixtures) with live edits applied locally only. Nothing is sent anywhere. The route
 * renders nothing in production builds.
 */
import { useState } from 'react';
import { applyEdit, decodePreset, fromHex, type Edit, type PocketMasterLink, type Preset } from '@pocket-master/core';
import { SettingsDialog } from '@/components/SettingsDialog';
import { ChainView } from '@/components/ChainView';
import { PresetSidebar } from '@/components/PresetSidebar';

const DUMP = '1241ff0010000100040002000000020004000a454d5100001800011004000a00000002100400080000000310040002000000010010000120040023000000022004007800000002008601013004005b01000002300a0000060102030405070809033028001b0000001a00000000000003110000070100000a35000001000000000000000b0100000c0000000f0430400100002041000000000000000000000000000000000000000000000000000000000000e0410000803f0000803f00000000000000000000000000000000000000000000204200008c420000484200000000000000000000000000000000000000000000f84100009041000000420000803f000000000000000000000000000000000000484200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004842000000000000000000001842000048420000000000000000000000000000000000000000000000000000a0410000fa430000f04100000000000000000000000000000000000000000000f041000000000000484200000000000000000000000000000000000000000000484200004842000048420000484200004842000000000000000000000000030008000000000000000000';
const NAMES = Array.from({ length: 100 }, (_, i) => (i < 50 ? ['MTL-CLEAN', 'MTL-RHY', 'MTL-LEAD', 'GNR-CLEAN', 'BlackAlbum'][i % 5]! : `Factory ${i - 49}`));

/** A stand-in link that answers the settings query with a V1.3.3 reply (Input -3 dB) and sends nothing. */
const GLOBALS = fromHex(
  '12 10 01 01 04 00 03 03 01 01 02 01 04 00 02 00 00 00 02 02 04 00 3C 00 00 00 01 02 01 00 00 03 ' +
  '02 01 00 64 01 03 01 00 FD 01 04 01 00 00 02 04 01 00 00 03 04 01 00 01 04 04 01 00 01 05 04 01 ' +
  '00 00 05 02 01 00 01',
);
const fakeLink = { request: async () => ({ payload: GLOBALS }), factoryReset: async () => undefined } as unknown as PocketMasterLink;
// Module-level, so its identity is stable: the dialog's read effect depends on it.
const fakeExclusive = <T,>(_step: string, run: (link: PocketMasterLink) => Promise<T>) => run(fakeLink);
const fakeReset = async () => true;

export default function Preview() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>(() => decodePreset(fromHex(DUMP)));
  const [editable, setEditable] = useState(true);
  const [current, setCurrent] = useState(33);
  if (process.env.NODE_ENV === 'production') return null;
  const onEdit = (e: Edit) => {
    try {
      setPreset((p) => applyEdit(p, e));
    } catch (error) {
      console.warn('preview edit refused:', error);
    }
  };
  return (
    <div className="layout">
      <PresetSidebar names={NAMES} current={current} modified={false} disabled={false} onReadNames={() => undefined} onLoad={setCurrent} />
      <main className="main">
        <label className="muted small"><input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} /> live edit (preview only)</label>
        <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>Global options</button>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} exclusive={fakeExclusive}
          writeGlobal={(b) => console.info('preview global write', b)} busy={false} error={null} factoryReset={fakeReset} onReset={() => undefined} />
        <ChainView preset={preset} presetIndex={current} presetName={NAMES[current] ?? null} editable={editable} modified={false} onEdit={onEdit}
          irNames={['Mesa OS', null, null, null, null]} profileNames={['Randall SA', null, null, null, null]} />
      </main>
    </div>
  );
}
