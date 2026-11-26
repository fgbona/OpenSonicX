/**
 * What the Matribox II Pro sends on its own, with no host request, when something changes on the
 * unit (docs/matribox.md, "The unit's own messages"). All are flag 1, cmd 0x10 (or 0x11 for the
 * "preset edited" flag); decoded from the owner's hardware capture (footswitches and knobs on the
 * unit, unit side only) and capture mb-17c (a block toggled on the unit, both sides).
 *
 * Captures mb-37, mb-42 and mb-44 (2026-11-25, unit side) added the global tempo turned on the unit,
 * the chain notice of a model changed on the unit and the save made on the unit; capture 2's
 * `00 52` message is the Current Mode changed on the unit, the shape of the host's global write.
 *
 * cmd 0x13 is the drum machine's state, the reply to the editor's connect read (layout cross-checked
 * against zxmarcos/waveod, MIT). A drum setting's answer (cmd 0x11, `00 8n 00 00` + u32, drum.ts) is a
 * `drumChange`: the unit sends it for the host's writes, and presumably for changes made on the unit.
 *
 * The preset-change notice has the same bytes as the unit's echo of a host select and its reply to
 * the current-preset read: a link must take those for itself first and pass on only the rest.
 */
import { mbDrumAnswer, type MbDrumChange } from './drum.ts';
import { MB_GLOBALS, type MbGlobalSetting } from './globals.ts';
import type { MbMessage } from './message.ts';
import { MB_SLOTS } from './write.ts';

export type MbNotice =
  /** `01 00 0A 01` + u32: another preset was loaded on the unit (footswitch, bank). Sent twice. */
  | { readonly kind: 'preset'; readonly index: number }
  /** `02 00 05 01` + u32 slot + u32 0/1: one block toggled on the unit. */
  | { readonly kind: 'blockOn'; readonly slot: number; readonly on: boolean }
  /** `07 00 05 01` + 12 × u8: every slot's on/off after a footswitch press. */
  | { readonly kind: 'blocksOn'; readonly on: readonly boolean[] }
  /** `01 00 05 01` + u32 slot + u32 param ID + f32: knob 1 or 2 turned on the unit. */
  | { readonly kind: 'param'; readonly slot: number; readonly id: number; readonly value: number }
  /** `03 00 05 01` + u32 0..100: knob 3 (patch volume) turned on the unit. */
  | { readonly kind: 'volume'; readonly value: number }
  /** cmd 0x11, `00 08 00 00` + u32: 1 once the loaded preset is edited, 0 after a save. */
  | { readonly kind: 'edited'; readonly edited: boolean }
  /**
   * cmd 0x11, `00 07 00 00` + u32: the unit showed "System overloaded" (1 the DSP ran out and every block
   * was switched off, 2 a block refused for memory). From zxmarcos/matribox-studio and waveod; not captured yet.
   */
  | { readonly kind: 'overload'; readonly cause: 'cpu' | 'memory' }
  /** cmd 0x11, `<index> <id> 00 00` + i32: a global setting changed on the unit (the host's write has this shape; the tempo's BPM in mb-37). */
  | { readonly kind: 'global'; readonly setting: MbGlobalSetting; readonly value: number }
  /** cmd 0x13, 10 bytes: u8 playing, 0, u16 genre, u16 pattern, u16 BPM, u8 follows the tempo, u8 volume 0..100. */
  | {
      readonly kind: 'drum';
      readonly playing: boolean;
      readonly genre: number;
      readonly pattern: number;
      readonly bpm: number;
      readonly follow: boolean;
      readonly volume: number;
    }
  /** cmd 0x11, `00 <81..86> 00 00` + u32: a drum machine setting as the unit now holds it (drum.ts). */
  | { readonly kind: 'drumChange'; readonly change: MbDrumChange }
  /** `00 00 04 01` + chain (89 bytes): the chain changed on the unit (a model, mb-42, mb-44); read the preset again. */
  | { readonly kind: 'chain' }
  /** cmd 0x05, u32 index + 17-byte name: the loaded preset saved on the unit (mb-44). */
  | { readonly kind: 'saved'; readonly index: number; readonly name: string };

/** The chain notice: `00 00 04 01` + 12 order + 12 modules + 12 u32 fxids + 12 on/off + 1 focus. */
const CHAIN_NOTICE_SIZE = 4 + 12 + 12 + 48 + 12 + 1;
const SAVE_NOTICE_SIZE = 4 + 17;
const EDITED = 0x0800;
const OVERLOAD = 0x0700;
const DRUM_SIZE = 10;
/** Settings by their u16 `<index> <id>`. */
const GLOBAL_BY_SUB = new Map<number, MbGlobalSetting>(Object.entries(MB_GLOBALS).map(([setting, { id, index }]) => [(id << 8) | index, setting as MbGlobalSetting]));

/** cmd 0x11, `<index> <id> 00 00` + i32: the edited flag or a global setting. */
function generalNotice(data: Uint8Array, view: DataView): MbNotice | null {
  if (data.length !== 8 || data[2] !== 0 || data[3] !== 0) return null;
  const sub = view.getUint16(0, true);
  if (sub === EDITED) return { kind: 'edited', edited: view.getUint32(4, true) !== 0 };
  if (sub === OVERLOAD) {
    const cause = view.getUint32(4, true);
    return cause === 0 ? null : { kind: 'overload', cause: cause === 2 ? 'memory' : 'cpu' };
  }
  const drum = mbDrumAnswer(sub, view.getUint32(4, true));
  if (drum) return { kind: 'drumChange', change: drum };
  const setting = GLOBAL_BY_SUB.get(sub);
  return setting ? { kind: 'global', setting, value: view.getInt32(4, true) } : null;
}

function drumState(view: DataView): MbNotice {
  const u16 = (at: number) => view.getUint16(at, true);
  return { kind: 'drum', playing: view.getUint8(0) !== 0, genre: u16(2), pattern: u16(4), bpm: u16(6), follow: view.getUint8(8) !== 0, volume: view.getUint8(9) };
}

const head = (data: Uint8Array) => Array.from(data.subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');

const nameOf = (field: Uint8Array) => {
  const end = field.indexOf(0);
  return String.fromCharCode(...field.subarray(0, end < 0 ? field.length : end));
};

/** The notice a message from the unit carries; null for anything else (replies, unknown notices). */
export function parseMbNotice({ flag, cmd, data }: MbMessage): MbNotice | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (cmd === 0x13) return data.length === DRUM_SIZE ? drumState(view) : null; // the read's reply (flag 0)
  if (flag !== 1) return null;
  const u32 = (at: number) => view.getUint32(at, true);
  if (cmd === 0x11) return generalNotice(data, view);
  if (cmd === 0x05) return data.length === SAVE_NOTICE_SIZE ? { kind: 'saved', index: u32(0), name: nameOf(data.subarray(4)) } : null;
  const kind = cmd === 0x10 ? head(data) : '';
  if (kind === '00000401' && data.length === CHAIN_NOTICE_SIZE) return { kind: 'chain' };
  if (kind === '01000a01' && data.length === 8) return { kind: 'preset', index: u32(4) };
  if (kind === '02000501' && data.length === 12) return { kind: 'blockOn', slot: u32(4), on: u32(8) !== 0 };
  if (kind === '07000501' && data.length === 4 + MB_SLOTS) return { kind: 'blocksOn', on: Array.from(data.subarray(4), (b) => b !== 0) };
  if (kind === '01000501' && data.length === 16) return { kind: 'param', slot: u32(4), id: u32(8), value: view.getFloat32(12, true) };
  if (kind === '03000501' && data.length === 8) return { kind: 'volume', value: u32(4) };
  return null;
}
