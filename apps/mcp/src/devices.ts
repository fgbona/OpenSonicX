/**
 * The pedals this server supports, told apart by their USB MIDI port name, and the shared code that
 * opens a pedal's ports. Each pedal has its own tools: the Pocket Master's are unprefixed (their names
 * are frozen for 1.x), the Matribox II Pro's start with matribox_.
 */
import { MATRIBOX_PORT_NAME } from '@pocket-master/core';

export interface PedalDevice {
  readonly name: string;
  /** Matches the pedal's MIDI port name. */
  readonly port: RegExp;
  /** Which tools drive it, for which_pedal. */
  readonly tools: string;
}

export const POCKET_MASTER: PedalDevice = { name: 'Sonicake Pocket Master', port: /pocket\s*master/i, tools: 'the tools without a prefix (get_preset, edit_preset, …)' };
export const MATRIBOX: PedalDevice = {
  name: 'Sonicake Matribox II Pro',
  port: new RegExp(MATRIBOX_PORT_NAME.replace(/\s+/g, '\\s*'), 'i'),
  tools: 'the matribox_ tools (read-only for now)',
};
export const PEDALS: readonly PedalDevice[] = [POCKET_MASTER, MATRIBOX];

/** The supported pedals among these MIDI port names, each with the port it was found on. */
export function detectPedals(portNames: readonly string[]): readonly { device: PedalDevice; port: string }[] {
  return PEDALS.flatMap((device) => {
    const port = portNames.find((name) => device.port.test(name));
    return port === undefined ? [] : [{ device, port }];
  });
}

/** which_pedal's answer. */
export function describePedals(portNames: readonly string[]): string {
  const found = detectPedals(portNames);
  if (found.length === 0) {
    return `No supported pedal is connected (MIDI ports: ${portNames.join(', ') || 'none'}). Supported: ${PEDALS.map((p) => p.name).join(', ')}. Plug the pedal in with a data USB cable, directly rather than through a hub.`;
  }
  return found.map(({ device, port }) => `${device.name} on MIDI port "${port}": use ${device.tools}.`).join('\n');
}

type Port = { getPortCount(): number; getPortName(index: number): string };
const names = (port: Port) => Array.from({ length: port.getPortCount() }, (_, i) => port.getPortName(i));

/** MIDI input port names, without opening any port. The native library loads on the first call. */
export async function midiPortNames(): Promise<readonly string[]> {
  const { Input } = await import('@julusian/midi');
  const input = new Input();
  try {
    return names(input);
  } finally {
    input.destroy();
  }
}

export interface MidiPorts {
  send(bytes: Uint8Array): void;
  /** Receives every SysEx message from the pedal (one receiver at a time). */
  listen(receiver: (bytes: Uint8Array) => void): void;
  close(): void;
}

function portIndex(port: Port, device: PedalDevice, kind: string): number {
  const found = names(port);
  const index = found.findIndex((name) => device.port.test(name));
  if (index < 0) {
    throw new Error(`No ${device.name} MIDI ${kind} (found: ${found.join(', ') || 'none'}). Plug the pedal in with a data USB cable, directly rather than through a hub.`);
  }
  return index;
}

/** Opens a pedal's USB MIDI input and output, SysEx enabled. */
export async function openPedalPorts(device: PedalDevice): Promise<MidiPorts> {
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
    input.ignoreTypes(false, true, true); // SysEx is ignored by default; the pedals speak nothing else
    input.on('messageBuffer', onMessage);
    input.openPort(portIndex(input, device, 'input'));
    output.openPort(portIndex(output, device, 'output'));
  } catch (error) {
    close();
    throw error;
  }
  return { send: (bytes) => output.sendMessage(Buffer.from(bytes)), listen: (r) => void (receiver = r), close };
}
