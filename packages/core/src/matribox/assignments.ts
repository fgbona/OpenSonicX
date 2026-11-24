/**
 * What a Matribox II Pro preset says about its patch volume, tempo, footswitch and expression-pedal
 * assignments (docs/matribox.md, "Unknown sections"): offsets in the section bodies, read only.
 *
 *   sec5: u16 patch volume at 736 (0..100), u16 tempo (BPM) at 738
 *   sec7: active EXP 1 mode at 4, target slot of entries 0..8 at 5 (FF = none), parameter at 14,
 *         f32 min at 23 + entry·4, f32 max at 59 + entry·4
 *   sec8: rows of 12 slot flags from 9: row r, column s = 1 when switch r toggles slot s
 */
import type { MbPreset } from './preset.ts';
import { MB_EXP_ENTRIES, MB_FOOTSWITCHES, MB_SLOTS } from './write.ts';

const NO_SLOT = 0xff;
const VOLUME_AT = 736;
const TEMPO_AT = 738;
const ROWS_AT = 9;

export interface MbExpressionEntry {
  readonly entry: number;
  /** Storage slot it moves; null when unused. */
  readonly slot: number | null;
  readonly paramId: number;
  readonly min: number;
  readonly max: number;
}

export interface MbAssignments {
  readonly volume: number;
  readonly tempo: number;
  /** Per footswitch A..D, the storage slots it toggles. */
  readonly footswitches: readonly (readonly number[])[];
  /** Which EXP 1 mode is active (0 = A, 1 = B; medium confidence). */
  readonly expressionMode: number;
  readonly expression: readonly MbExpressionEntry[];
}

function section(preset: MbPreset, id: number): DataView {
  const body = preset.sections.find((s) => s.id === id)?.body;
  if (!body) throw new Error(`Matribox preset: no section ${id}`);
  return new DataView(body.buffer, body.byteOffset, body.byteLength);
}

export function mbAssignments(preset: MbPreset): MbAssignments {
  const s5 = section(preset, 5);
  const s7 = section(preset, 7);
  const s8 = section(preset, 8);
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  return {
    volume: s5.getUint16(VOLUME_AT, true),
    tempo: s5.getUint16(TEMPO_AT, true),
    footswitches: range(MB_FOOTSWITCHES).map((row) => range(MB_SLOTS).filter((slot) => s8.getUint8(ROWS_AT + row * MB_SLOTS + slot) === 1)),
    expressionMode: s7.getUint8(4),
    expression: range(MB_EXP_ENTRIES).map((entry) => {
      const slot = s7.getUint8(5 + entry);
      return {
        entry,
        slot: slot === NO_SLOT ? null : slot,
        paramId: s7.getUint8(14 + entry),
        min: s7.getFloat32(23 + entry * 4, true),
        max: s7.getFloat32(59 + entry * 4, true),
      };
    }),
  };
}

/** The preset with another patch volume (a live edit shown before the unit confirms it). */
export function withMbVolume(preset: MbPreset, volume: number): MbPreset {
  return {
    ...preset,
    sections: preset.sections.map((s) => {
      if (s.id !== 5) return s;
      const body = Uint8Array.from(s.body);
      new DataView(body.buffer).setUint16(VOLUME_AT, volume, true);
      return Object.freeze({ ...s, body });
    }),
  };
}
