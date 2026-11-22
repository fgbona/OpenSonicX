/**
 * The core test suite's FakePedal behind a SysEx wire: takes the frames the editor sends and
 * returns the frames the Pocket Master would answer with (multi-packet replies, 14 08 acks).
 * It runs in the Playwright process; e2e/fixtures.ts bridges it to the page's fake Web MIDI.
 */
import { buildFrame, fromHex, parseFrame } from '@pocket-master/core';
import { FakePedal } from '../../../packages/core/test/fake-pedal.ts';

const GET = 0x12;
const SET = 0x11;
const PACKET = 200;
const ACK_OK = [0x14, 0x08, 0x00];
/** A V1.3.3 settings reply (Input -3 dB), the one the preview page uses. */
const GLOBALS = fromHex(
  '12 10 01 01 04 00 03 03 01 01 02 01 04 00 02 00 00 00 02 02 04 00 3C 00 00 00 01 02 01 00 00 03 ' +
  '02 01 00 64 01 03 01 00 FD 01 04 01 00 00 02 04 01 00 00 03 04 01 00 01 04 04 01 00 01 05 04 01 ' +
  '00 00 05 02 01 00 01',
);

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const ascii = (s: string, size: number) => Array.from({ length: size }, (_, i) => s.charCodeAt(i) || 0);

/** Splits a reply payload into packets, as the pedal does for long replies. */
function packets(payload: ArrayLike<number>): Uint8Array[] {
  const bytes = Array.from(payload);
  const total = Math.max(1, Math.ceil(bytes.length / PACKET));
  return Array.from({ length: total }, (_, i) => buildFrame(bytes.slice(i * PACKET, (i + 1) * PACKET), total, i));
}

export class SysexPedal {
  readonly pedal = new FakePedal({}, 8);
  /** The 12 10 reply; tests can change the firmware version in it. */
  globals: Uint8Array = GLOBALS;
  irNames = ['Marshal 80', 'Brutal Pri', '', '', ''];
  profileNames = ['Randall SA', '', '', '', ''];
  /** Control changes received (the tuner), as hex. */
  readonly controls: string[] = [];

  /** The frames the pedal sends back for one frame from the editor. */
  async receive(sysex: Uint8Array): Promise<Uint8Array[]> {
    if (sysex[0] === 0xb0) {
      this.controls.push(Array.from(sysex, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
      return [];
    }
    const p = parseFrame(sysex).payload;
    if (p[0] === GET && p[1] === 0x4f) return packets(this.#stored(p[2]! | (p[3]! << 8)));
    if (p[0] === GET) return packets(this.#answer(p[1]!));
    if (p[0] !== SET) return [];
    if (p[1] === 0x43) await this.pedal.selectPreset(p[2]!);
    else if (p[1] === 0x4b) this.#copy(p[2]! | (p[3]! << 8), p[4]! | (p[5]! << 8));
    else if (p[1] === 0x4a) await this.pedal.savePreset(p[2]!, String.fromCharCode(...p.subarray(6, 16)).replace(/\0.*$/, ''));
    else if ([0x42, 0x44, 0x47, 0x48, 0x49].includes(p[1]!)) await this.pedal.sendEdits([sysex]);
    return [buildFrame(ACK_OK)];
  }

  #answer(kind: number): ArrayLike<number> {
    switch (kind) {
      case 0x41: return this.pedal.editBuffer;
      case 0x43: return [GET, kind, this.pedal.current, 0, 0, 0];
      // Like the unit: "modified" while the edit buffer differs from the loaded slot.
      case 0x45: return [GET, kind, this.pedal.editBuffer.join() === this.pedal.slots[this.pedal.current]!.join() ? 0 : 1];
      case 0x40: return [GET, kind, ...this.pedal.names.flatMap((name, i) => [...u32(i), ...ascii(name, 16)])];
      case 0x20: return this.#slots(kind, this.irNames);
      case 0x24: return this.#slots(kind, this.profileNames);
      case 0x10: return this.globals;
      default: return [GET, kind, 0];
    }
  }

  /** 12 4F: a stored preset without loading it: FF FF FF FF, a 16-byte name, then the edit buffer's body. */
  #stored(index: number): number[] {
    return [GET, 0x4f, 0xff, 0xff, 0xff, 0xff, ...ascii(this.pedal.names[index]!, 16), ...Array.from(this.pedal.slots[index]!).slice(2)];
  }

  /** 11 4B: the source slot (and its name) over the destination, the loaded preset untouched. */
  #copy(destination: number, source: number) {
    this.pedal.slots[destination] = this.pedal.slots[source]!.slice();
    this.pedal.names[destination] = this.pedal.names[source]!;
  }

  #slots(kind: number, names: string[]) {
    return [GET, kind, ...names.map((n) => (n ? 0 : 1)), ...names.flatMap((n) => ascii(n, 16))];
  }
}
