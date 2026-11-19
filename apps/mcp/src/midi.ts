import { linkPedal, MessageType, PocketMasterLink, Query, readProfileNames, readUserIrNames, uploadUserIr, type LogEntry, type SlotName } from '@pocket-master/core';
import type { Connection, PedalIO } from './session.ts';

const PORT_NAME = /pocket\s*master/i;

type Port = { getPortCount(): number; getPortName(index: number): string };

function portIndex(port: Port, kind: string): number {
  const names = Array.from({ length: port.getPortCount() }, (_, i) => port.getPortName(i));
  const index = names.findIndex((name) => PORT_NAME.test(name));
  if (index < 0) {
    throw new Error(`No Pocket Master MIDI ${kind} (found: ${names.join(', ') || 'none'}). Plug the pedal in with a data USB cable, directly rather than through a hub.`);
  }
  return index;
}

const loadedNames = (slots: SlotName[]) => slots.map((s) => (s.empty || !s.name ? null : s.name));

/**
 * Opens the pedal's USB MIDI ports and the guarded core link over them. The native MIDI library
 * loads on the first call, so the server starts (and lists its tools) even where MIDI is missing.
 */
export async function connectPocketMaster(onLog: (entry: LogEntry) => void = () => undefined): Promise<Connection> {
  const { Input, Output } = await import('@julusian/midi');
  const input = new Input();
  const output = new Output();
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  const onMessage = (_deltaTime: number, message: Buffer) => receiver?.(new Uint8Array(message));
  const close = () => {
    input.off('messageBuffer', onMessage);
    input.closePort();
    output.closePort();
    input.destroy(); // a new pair is opened per call: free the native clients too
    output.destroy();
  };
  try {
    input.ignoreTypes(false, true, true); // SysEx is ignored by default; the pedal speaks nothing else
    input.on('messageBuffer', onMessage);
    input.openPort(portIndex(input, 'input'));
    output.openPort(portIndex(output, 'output'));
  } catch (error) {
    close();
    throw error;
  }
  const link = new PocketMasterLink({ send: (bytes) => output.sendMessage(Buffer.from(bytes)), listen: (r) => void (receiver = r) }, onLog);
  const io: PedalIO = {
    ...linkPedal(link),
    async readSlotNames() {
      return { irNames: loadedNames(await readUserIrNames(link)), profileNames: loadedNames(await readProfileNames(link)) };
    },
    async uploadIr(slot, name, wav) {
      await uploadUserIr(link, slot, name, wav);
    },
    async readModified() {
      const { payload } = await link.request(Query.MODIFIED);
      return payload[0] === MessageType.GET && payload.length >= 3 ? payload[2] !== 0 : null;
    },
  };
  return { io, close: () => { link.close(); close(); } };
}
