/**
 * What the Matribox II Pro sends on its own, with no host request, when something changes on the
 * unit (docs/matribox.md, "The unit's own messages"). All are flag 1, cmd 0x10 (or 0x11 for the
 * "preset edited" flag); decoded from the owner's hardware capture (footswitches and knobs on the
 * unit, unit side only) and capture mb-17c (a block toggled on the unit, both sides).
 *
 * The preset-change notice has the same bytes as the unit's echo of a host select and its reply to
 * the current-preset read: a link must take those for itself first and pass on only the rest.
 */
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
  | { readonly kind: 'edited'; readonly edited: boolean };

const head = (data: Uint8Array) => Array.from(data.subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');

/** The notice a message from the unit carries; null for anything else (replies, unknown notices). */
export function parseMbNotice({ flag, cmd, data }: MbMessage): MbNotice | null {
  if (flag !== 1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const kind = cmd === 0x11 ? `11:${head(data)}` : cmd === 0x10 ? head(data) : '';
  if (kind === '11:00080000' && data.length === 8) return { kind: 'edited', edited: u32(4) !== 0 };
  if (kind === '01000a01' && data.length === 8) return { kind: 'preset', index: u32(4) };
  if (kind === '02000501' && data.length === 12) return { kind: 'blockOn', slot: u32(4), on: u32(8) !== 0 };
  if (kind === '07000501' && data.length === 4 + MB_SLOTS) return { kind: 'blocksOn', on: Array.from(data.subarray(4), (b) => b !== 0) };
  if (kind === '01000501' && data.length === 16) return { kind: 'param', slot: u32(4), id: u32(8), value: view.getFloat32(12, true) };
  if (kind === '03000501' && data.length === 8) return { kind: 'volume', value: u32(4) };
  return null;
}
