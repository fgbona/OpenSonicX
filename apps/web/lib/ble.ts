import type { MidiPort } from '@pocket-master/core';

/**
 * Bluetooth LE MIDI link to the pedal (Web Bluetooth, Chrome and Edge on desktop and Android).
 * Service and characteristic are the standard BLE-MIDI ones; the pedal takes each SysEx whole,
 * after the `80 80` header and timestamp, as SonicMaster (github.com/skyggedans/SonicMaster,
 * MIT) sends it.
 */
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const BLE_HEADER = 0x80;
const BLE_TIMESTAMP = 0x80;

/** The parts of Web Bluetooth used here (TypeScript's DOM library does not declare them). */
export interface GattCharacteristic {
  writeValueWithoutResponse(value: Uint8Array): Promise<void>;
  startNotifications?(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', listener: (event: { target: { value: DataView } }) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: { target: { value: DataView } }) => void): void;
}
interface GattServer {
  connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<GattCharacteristic> }>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: GattServer;
}
interface Bluetooth {
  requestDevice(options: { filters: { services: string[] }[]; optionalServices?: string[] }): Promise<BleDevice>;
}

export function bleWire(sysex: Uint8Array): Uint8Array {
  return Uint8Array.from([BLE_HEADER, BLE_TIMESTAMP, ...sysex]);
}

/**
 * Turns BLE-MIDI notifications back into SysEx messages. Every data byte of this protocol is a
 * nibble (0x00..0x0F), so any byte with the top bit set other than F0/F7 is a BLE header or
 * timestamp and is dropped; a message may span notifications.
 */
export class BleSysexAssembler {
  #buffer: number[] | null = null;

  feed(packet: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const byte of packet) {
      if (byte === SYSEX_START) this.#buffer = [byte];
      else if (byte === SYSEX_END && this.#buffer) {
        out.push(Uint8Array.from([...this.#buffer, byte]));
        this.#buffer = null;
      } else if (byte < 0x80 && this.#buffer) this.#buffer.push(byte);
    }
    return out;
  }
}

/** The characteristic as the core link's port. Writes go out one at a time (GATT allows one). */
export function bleMidiPort(characteristic: GattCharacteristic, onError: (error: unknown) => void): MidiPort {
  let queue: Promise<void> = Promise.resolve();
  let handler: ((event: { target: { value: DataView } }) => void) | null = null;
  const assembler = new BleSysexAssembler();
  return {
    send: (bytes) => {
      const wire = bleWire(bytes);
      queue = queue
        .then(() => characteristic.writeValueWithoutResponse(wire))
        .catch((error: unknown) => {
          console.error('Bluetooth write failed', error);
          onError(error);
        });
    },
    listen: (receiver) => {
      if (handler) characteristic.removeEventListener('characteristicvaluechanged', handler);
      handler = null;
      if (!receiver) return;
      handler = (event) => {
        const v = event.target.value;
        assembler.feed(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).forEach(receiver);
      };
      characteristic.addEventListener('characteristicvaluechanged', handler);
    },
  };
}

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export interface BleConnection {
  readonly name: string;
  readonly port: MidiPort;
  close(): void;
}

/**
 * Opens the browser's device chooser (needs a click), connects and subscribes. `onDrop` runs when
 * the pedal goes away (switched off, out of range).
 */
export async function connectBluetooth(onError: (error: unknown) => void, onDrop: () => void): Promise<BleConnection> {
  if (!bluetoothAvailable()) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.');
  const bluetooth = (navigator as unknown as { bluetooth: Bluetooth }).bluetooth;
  const device = await bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] });
  if (!device.gatt) throw new Error('The chosen device has no Bluetooth LE services.');
  const server = await device.gatt.connect();
  const characteristic = await (await server.getPrimaryService(BLE_MIDI_SERVICE)).getCharacteristic(BLE_MIDI_CHARACTERISTIC);
  await characteristic.startNotifications?.();
  const dropped = () => onDrop();
  device.addEventListener('gattserverdisconnected', dropped);
  return {
    name: device.name ?? 'Bluetooth MIDI',
    port: bleMidiPort(characteristic, onError),
    close: () => {
      device.removeEventListener('gattserverdisconnected', dropped);
      if (server.connected) server.disconnect();
    },
  };
}
