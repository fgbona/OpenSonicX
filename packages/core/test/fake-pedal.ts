import { parseFrame } from '../src/frame.ts';
import { Reassembler } from '../src/reassembler.ts';
import { findCloneModel, findModel, blockByModule, CLONE_MODULE } from '../src/catalog.ts';
import { decodePresetNames } from '../src/slots.ts';
import type { Pedal } from '../src/backup.ts';
import { readCapture } from './capture.ts';

const TAG = { VOLUME: 0x2001, STATES: 0x3001, CHAIN: 0x3002, EFFECTS: 0x3003, PARAMS: 0x3004 } as const;

/** Real P08 edit-buffer payload and the owner's 100 real preset names. */
export function realP08(): Uint8Array {
  const r = new Reassembler();
  const rx = readCapture('p08-capture.txt').filter((m) => m.dir === 'RX').slice(1);
  return rx.map((m) => r.feed(parseFrame(m.bytes), 0)).at(-1)!.payload.slice();
}
export function realNames(): string[] {
  const r = new Reassembler();
  const rx = readCapture('names-capture.txt').filter((m) => m.dir === 'RX').slice(2);
  return decodePresetNames(rx.map((m) => r.feed(parseFrame(m.bytes), 0)).at(-1)!.payload);
}

/** Offset of a record's data inside a dump payload, found by its tag header. */
function recordAt(payload: Uint8Array, tag: number): number {
  for (let i = 0; i + 4 <= payload.length; i++) {
    if (payload[i] === (tag & 0xff) && payload[i + 1] === tag >> 8) {
      const len = payload[i + 2]! | (payload[i + 3]! << 8);
      if (i + 4 + len <= payload.length && [4, 10, 40, 320].includes(len)) return i + 4;
    }
  }
  throw new Error(`record 0x${tag.toString(16)} not found`);
}

export interface FakeOptions {
  /** Selecting index i loads i + 1 instead (a wrong-slot bug). */
  wrongSelect?: boolean;
  /** The save acknowledge reports failure. */
  nack?: boolean;
  /** The save is never acknowledged. */
  noAck?: boolean;
  /** The save is acknowledged but writes a different volume into the slot. */
  saveCorrupts?: boolean;
  /** The save is acknowledged but the slot keeps its old name. */
  saveKeepsName?: boolean;
}

/**
 * Simulated Pocket Master: 100 slots of dump bytes, an edit buffer, the loaded index and names.
 * Commands are applied to the dump bytes the way the unit applies them.
 */
export class FakePedal implements Pedal {
  readonly slots: Uint8Array[];
  readonly names: string[];
  current: number;
  editBuffer: Uint8Array;
  /** Every command received, as [command byte, …]. */
  readonly received: string[] = [];
  readonly options: FakeOptions;
  constructor(options: FakeOptions = {}, start = 8) {
    this.options = options;
    const base = realP08();
    this.slots = Array.from({ length: 100 }, (_, i) => {
      const p = base.slice();
      new DataView(p.buffer).setUint32(recordAt(p, TAG.VOLUME), i, true); // each slot is distinguishable
      return p;
    });
    this.names = realNames();
    this.current = start;
    this.editBuffer = this.slots[start]!.slice();
  }

  async readCurrentIndex() { return this.current; }
  async readEditBuffer() { return this.editBuffer.slice(); }
  async readNames() { return [...this.names]; }

  async selectPreset(index: number) {
    this.received.push(`select ${index}`);
    this.current = this.options.wrongSelect ? index + 1 : index;
    this.editBuffer = this.slots[this.current]!.slice();
  }

  async sendEdits(commands: Uint8Array[]) {
    for (const c of commands) this.apply(parseFrame(c).payload);
  }

  async savePreset(index: number, name: string) {
    this.received.push(`save ${index} ${name}`);
    if (this.options.noAck) throw new Error('no acknowledge from the pedal');
    if (this.options.nack) return false;
    this.slots[index] = this.editBuffer.slice();
    if (this.options.saveCorrupts) new DataView(this.slots[index]!.buffer).setUint32(recordAt(this.slots[index]!, TAG.VOLUME), 3, true);
    if (!this.options.saveKeepsName) this.names[index] = name;
    this.current = index;
    return true;
  }

  private apply(p: Uint8Array) {
    const v = new DataView(this.editBuffer.buffer);
    const arg = (o: number) => new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(o, true);
    const cmd = p[1];
    this.received.push(`edit ${cmd!.toString(16)}`);
    if (cmd === 0x49) {
      const at = recordAt(this.editBuffer, TAG.STATES);
      const mask = v.getUint32(at, true);
      const bit = 1 << arg(2);
      v.setUint32(at, arg(6) ? mask | bit : mask & ~bit, true);
    } else if (cmd === 0x48) {
      v.setFloat32(recordAt(this.editBuffer, TAG.PARAMS) + 32 * arg(2) + 4 * arg(6), new DataView(p.buffer, p.byteOffset).getFloat32(10, true), true);
    } else if (cmd === 0x47) {
      const module = arg(2);
      const code = arg(10);
      v.setUint32(recordAt(this.editBuffer, TAG.EFFECTS) + 4 * module, code, true);
      const model = module === CLONE_MODULE ? findCloneModel(code) : findModel(blockByModule(module)!.key, code);
      const params = recordAt(this.editBuffer, TAG.PARAMS) + 32 * module;
      for (let alg = 0; alg < 8; alg++) {
        const spec = model?.params.find((s) => s.alg === alg);
        v.setFloat32(params + 4 * alg, spec ? (spec.default ?? spec.min ?? 0) : 0, true);
      }
    } else if (cmd === 0x44) {
      this.editBuffer.set(p.subarray(2, 11), recordAt(this.editBuffer, TAG.CHAIN));
    } else if (cmd === 0x42) {
      v.setUint32(recordAt(this.editBuffer, TAG.VOLUME), p[6]!, true);
    } else {
      throw new Error(`fake pedal: unexpected command ${cmd}`);
    }
  }
}
