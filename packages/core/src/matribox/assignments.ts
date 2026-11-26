/**
 * What a Matribox II Pro preset says about its patch volume, tempo, footswitch functions, CTRL groups,
 * quick knobs and expression-pedal assignments (docs/matribox.md, "Unknown sections"): offsets in the
 * section bodies, read only. Layout cross-checked with waveod's reimplemented firmware
 * (github.com/zxmarcos/waveod, MIT, (c) 2026 Marcos Medeiros: fw/preset_format.h, editor/preset_msgs.c).
 *
 *   sec2: quick knob 1..3 target at 4..6 (slot 0..11, 12 BPM, 13 volume, FF none), parameter at 7..9
 *   sec3: stomp-mode function of footswitch A..D pressed at 4..7, held at 8..11 (then 3 combos)
 *   sec5: u16 patch volume at 736 (0..100), u16 tempo (BPM) at 738
 *   sec7: active EXP 1 mode at 4, target slot of entries 0..8 at 5 (FF = none), parameter at 14,
 *         f32 min at 23 + entry·4, f32 max at 59 + entry·4
 *   sec8: rows of 12 slot flags from 9: row r, column s = 1 when slot s is in CTRL r + 1 (row 4: the preset CTRL)
 */
import type { MbPreset } from './preset.ts';
import { MB_CTRLS, MB_EXP_ENTRIES, MB_FOOTSWITCHES, MB_FS_CTRL1, MB_FS_FUNCTIONS, MB_QK_BPM, MB_QK_VOLUME, MB_QUICK_KNOBS, MB_SLOTS, mbAssignCtrl, mbSetFootswitchFunction } from './write.ts';

const NO_SLOT = 0xff;
const VOLUME_AT = 736;
const TEMPO_AT = 738;
const ROWS_AT = 9;
/** The firmware's "toggle slot 1..12" functions, which the official editor does not offer. */
const FS_SLOT1 = 24;

export interface MbExpressionEntry {
  readonly entry: number;
  /** Storage slot it moves; null when unused. */
  readonly slot: number | null;
  readonly paramId: number;
  readonly min: number;
  readonly max: number;
}

export interface MbFootswitch {
  /** Function id (MB_FS_FUNCTIONS) run on a press and on a hold, in stomp mode. */
  readonly press: number;
  readonly hold: number;
}

export interface MbQuickKnob {
  readonly knob: number;
  /** Storage slot 0..11, MB_QK_BPM, MB_QK_VOLUME; null when unused. */
  readonly target: number | null;
  /** Catalog widget ID of the parameter (for a slot). */
  readonly paramId: number;
}

export interface MbAssignments {
  readonly volume: number;
  readonly tempo: number;
  /** Footswitches A..D in stomp mode. */
  readonly footswitches: readonly MbFootswitch[];
  /** Per CTRL 1..4, the storage slots in it. */
  readonly ctrl: readonly (readonly number[])[];
  readonly quickKnobs: readonly MbQuickKnob[];
  /** Which EXP 1 mode is active (0 = A, 1 = B; medium confidence). */
  readonly expressionMode: number;
  readonly expression: readonly MbExpressionEntry[];
}

function section(preset: MbPreset, id: number): DataView {
  const body = preset.sections.find((s) => s.id === id)?.body;
  if (!body) throw new Error(`Matribox preset: no section ${id}`);
  return new DataView(body.buffer, body.byteOffset, body.byteLength);
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function mbAssignments(preset: MbPreset): MbAssignments {
  const [s2, s3, s5, s7, s8] = [2, 3, 5, 7, 8].map((id) => section(preset, id)) as [DataView, DataView, DataView, DataView, DataView];
  return {
    volume: s5.getUint16(VOLUME_AT, true),
    tempo: s5.getUint16(TEMPO_AT, true),
    footswitches: range(MB_FOOTSWITCHES).map((fs) => ({ press: s3.getUint8(4 + fs), hold: s3.getUint8(8 + fs) })),
    ctrl: range(MB_CTRLS).map((row) => range(MB_SLOTS).filter((slot) => s8.getUint8(ROWS_AT + row * MB_SLOTS + slot) === 1)),
    quickKnobs: range(MB_QUICK_KNOBS).map((knob) => {
      const target = s2.getUint8(4 + knob);
      return { knob, target: target === NO_SLOT ? null : target, paramId: s2.getUint8(7 + knob) };
    }),
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

/** A footswitch function's name ("CTRL 1", "tuner"); one the editor does not offer reads as such. */
export function mbFsFunctionName(id: number): string {
  const known = MB_FS_FUNCTIONS.find((f) => f.id === id)?.name;
  if (known) return known;
  return id >= FS_SLOT1 && id < FS_SLOT1 + MB_SLOTS ? `block in slot ${id - FS_SLOT1 + 1}` : `unknown function ${id}`;
}

/** A footswitch function by its name, in any case ("Tap Tempo" → 8). */
export function mbFsFunctionId(name: string): number {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
  const found = MB_FS_FUNCTIONS.find((f) => f.name.toLowerCase() === key);
  if (!found) throw new Error(`no footswitch function "${name}"; the functions are: ${MB_FS_FUNCTIONS.map((f) => f.name).join(', ')}`);
  return found.id;
}

/** The CTRL (0..3) a footswitch function switches, or null. */
export const mbFsCtrl = (fn: number): number | null => (fn >= MB_FS_CTRL1 && fn < MB_FS_CTRL1 + MB_CTRLS ? fn - MB_FS_CTRL1 : null);

/**
 * The writes that make footswitch `footswitch` (A = 0) toggle storage `slot` in stomp mode, or stop
 * it: the slot goes in or out of the CTRL the switch's press runs. A switch on anything else (tuner,
 * tap…) is first set to its own CTRL (A → CTRL 1); stopping it then has nothing to undo.
 */
export function mbFootswitchToggleWrites(a: MbAssignments, footswitch: number, slot: number, on: boolean): Uint8Array[] {
  const fs = a.footswitches[footswitch];
  if (!fs) throw new RangeError(`Matribox write: footswitch must be 0..${MB_FOOTSWITCHES - 1} (A..D), got ${footswitch}`);
  const ctrl = mbFsCtrl(fs.press);
  if (ctrl !== null) return [mbAssignCtrl(ctrl, slot, on)];
  return on ? [mbSetFootswitchFunction(footswitch, MB_FS_CTRL1 + footswitch), mbAssignCtrl(footswitch, slot, true)] : [];
}

const LETTERS = 'ABCD';
const round = (n: number) => String(Number(n.toFixed(2)));

/** Names the blocks of the loaded preset for mbAssignmentsText. */
export interface MbAssignmentNames {
  /** "2 DRV", or "slot 5 (empty)". */
  block(slot: number): string;
  /** The parameter's name in the slot's model. */
  param(slot: number, paramId: number): string;
}

/** One line per footswitch, CTRL, quick knob and used expression entry, for the AI tools. */
export function mbAssignmentsText(a: MbAssignments, names: MbAssignmentNames): string[] {
  const blocks = (slots: readonly number[]) => slots.map(names.block).join(', ') || 'nothing';
  const footswitches = a.footswitches.map((f, i) => {
    const ctrl = mbFsCtrl(f.press);
    const toggles = ctrl === null ? '' : ` (toggles ${blocks(a.ctrl[ctrl] ?? [])})`;
    return `Footswitch ${LETTERS[i]}: ${mbFsFunctionName(f.press)}${toggles}${f.hold ? `; held: ${mbFsFunctionName(f.hold)}` : ''}`;
  });
  const ctrl = a.ctrl.map((slots, i) => `CTRL ${i + 1}: ${blocks(slots)}`);
  const knobs = a.quickKnobs.map((q) => {
    const target = q.target === null ? 'unused' : q.target === MB_QK_BPM ? 'tempo (BPM)' : q.target === MB_QK_VOLUME ? 'patch volume' : `${names.block(q.target)} ${names.param(q.target, q.paramId)}`;
    return `Quick knob ${q.knob + 1}: ${target}`;
  });
  const entries = a.expression
    .filter((e) => e.slot !== null)
    .map((e) => `Expression entry ${e.entry + 1}: ${names.block(e.slot as number)} ${names.param(e.slot as number, e.paramId)}, ${round(e.min)}..${round(e.max)} %`);
  return [...footswitches, ...ctrl, ...knobs, ...(entries.length ? entries : ['Expression: no entry used'])];
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
