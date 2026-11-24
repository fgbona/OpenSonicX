import { clearUserIr, clearUserProfile, copyStoredPreset, linkPedal, readGlobals, MessageType, PocketMasterLink, Query, readProfileNames, readUserIrNames, renameUserIr, renameUserProfile, uploadUserIr, uploadUserProfile, type LogEntry, type SlotName } from '@pocket-master/core';
import { openPedalPorts, POCKET_MASTER } from './devices.ts';
import type { Connection, PedalIO } from './session.ts';

const loadedNames = (slots: SlotName[]) => slots.map((s) => (s.empty || !s.name ? null : s.name));

/**
 * Opens the pedal's USB MIDI ports and the guarded core link over them. The native MIDI library
 * loads on the first call, so the server starts (and lists its tools) even where MIDI is missing.
 */
export async function connectPocketMaster(onLog: (entry: LogEntry) => void = () => undefined): Promise<Connection> {
  const ports = await openPedalPorts(POCKET_MASTER);
  const link = new PocketMasterLink({ send: ports.send, listen: ports.listen }, onLog);
  const io: PedalIO = {
    ...linkPedal(link),
    async readSlotNames() {
      return { irNames: loadedNames(await readUserIrNames(link)), profileNames: loadedNames(await readProfileNames(link)) };
    },
    async uploadIr(slot, name, wav) {
      await uploadUserIr(link, slot, name, wav);
    },
    async uploadProfile(slot, name, arrays) {
      await uploadUserProfile(link, slot, name, arrays);
    },
    async renameSlot(kind, slot, name) {
      await (kind === 'ir' ? renameUserIr : renameUserProfile)(link, slot, name);
    },
    copyPreset: (destination, source) => copyStoredPreset(link, destination, source),
    setTuner: (on) => link.setTuner(on),
    async clearSlot(kind, slot) {
      await (kind === 'ir' ? clearUserIr : clearUserProfile)(link, slot);
    },
    readGlobals: () => readGlobals(link),
    async writeGlobals(bytes) {
      bytes.forEach((b) => link.edit(b));
      await link.drained();
    },
    async readModified() {
      const { payload } = await link.request(Query.MODIFIED);
      return payload[0] === MessageType.GET && payload.length >= 3 ? payload[2] !== 0 : null;
    },
  };
  return { io, close: () => { link.close(); ports.close(); } };
}
