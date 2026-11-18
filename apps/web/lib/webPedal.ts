import { decodeCurrentPreset, decodePresetNames, Query, savePreset, selectPreset, type Pedal } from '@pocket-master/core';
import type { PocketMasterLink } from './midi';

/** After its acknowledge the pedal still needs a moment before it reports the new preset (V1.3.3: ~250 ms works). */
const SELECT_SETTLE_MS = 250;
const EDIT_SETTLE_MS = 100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The core Pedal contract over a Web MIDI link. */
export function webPedal(link: PocketMasterLink): Pedal {
  return {
    async readCurrentIndex() {
      return decodeCurrentPreset((await link.request(Query.CURRENT_PRESET)).payload);
    },
    async readEditBuffer() {
      return (await link.request(Query.EDIT_BUFFER)).payload;
    },
    async readNames() {
      return decodePresetNames((await link.request(Query.PRESET_NAMES)).payload);
    },
    async selectPreset(index) {
      const ok = await link.presetOperation(selectPreset(index));
      if (!ok) throw new Error(`the pedal refused to load preset ${index + 1}`);
      await wait(SELECT_SETTLE_MS);
    },
    async sendEdits(commands) {
      if (commands.length === 0) return;
      commands.forEach((bytes) => link.edit(bytes));
      await link.drained();
      await wait(EDIT_SETTLE_MS);
    },
    async savePreset(index, name) {
      return link.presetOperation(savePreset(index, name));
    },
  };
}
