import { buildFrame } from './frame.ts';
import { MessageType, Query } from './queries.ts';

/**
 * Device-wide settings (not stored in presets): the reply to 12 10, and their writes.
 *
 * Ported from SonicMaster (github.com/skyggedans/SonicMaster, MIT, commit 931a68f):
 * global_settings_decoder.dart and global_setting_writer.dart, which reproduce the official
 * app's captured frames byte for byte. A setting write is `11 11 a0 a1 00 00 <int32 LE>`;
 * the EXP/FS targets are register writes `11 <reg> <sub> <value>`; factory reset is `11 3F`.
 */

export interface GlobalSettings {
  /** Master volume, 0..100. */
  readonly masterVolume: number;
  /** Levels in dB, -20..20. */
  readonly inputLevel: number;
  readonly fxRecLevel: number;
  readonly monitorLevel: number;
  readonly btRecLevel: number;
  /** The settings below are null when the dump is too short to hold them. */
  readonly backlight: number | null;
  /** USB recording: 0 dry, 1 wet. */
  readonly mode: number | null;
  readonly reamp: number | null;
  readonly eco: number | null;
  /** 0 expression pedal, 1 single footswitch, 2 dual footswitch. */
  readonly expFsType: number | null;
}

interface SettingSpec {
  readonly address: readonly [number, number];
  readonly min: number;
  readonly max: number;
}

const LEVEL = { min: -20, max: 20 } as const;
const FLAG = { min: 0, max: 1 } as const;

/** Writable settings. Power confirm and battery-only are writable but not in the dump. */
export const GLOBAL_SETTINGS = {
  masterVolume: { address: [0x02, 0x02], min: 0, max: 100 },
  inputLevel: { address: [0x01, 0x03], ...LEVEL },
  fxRecLevel: { address: [0x01, 0x04], ...LEVEL },
  monitorLevel: { address: [0x02, 0x04], ...LEVEL },
  btRecLevel: { address: [0x05, 0x04], ...LEVEL },
  mode: { address: [0x04, 0x04], ...FLAG },
  reamp: { address: [0x06, 0x04], ...FLAG },
  expFsType: { address: [0x01, 0x05], min: 0, max: 2 },
  // 0..100: the unit reports 100 at full brightness (SonicMaster's dialog stops at 10).
  backlight: { address: [0x03, 0x02], min: 0, max: 100 },
  eco: { address: [0x04, 0x02], ...FLAG },
  powerConfirm: { address: [0x05, 0x02], ...FLAG },
  battOnly: { address: [0x06, 0x02], ...FLAG },
} as const satisfies Record<string, SettingSpec>;
export type GlobalSetting = keyof typeof GLOBAL_SETTINGS;

/** What an expression pedal can drive (register 0x17), by wire value. */
export const EXP_TARGETS = ['VOL', 'FX1', 'DRV', 'AMP', 'IR', 'FX2', 'DLY', 'RVB'] as const;
/** What an external footswitch can do (register 0x16), by wire value. */
export const FS_TARGETS = [
  'Preset-', 'Preset+', 'Tap Tempo', 'NR', 'FX1', 'DRV', 'AMP', 'IR', 'EQ', 'FX2', 'DLY', 'RVB',
  'CTRL 1', 'CTRL 2', 'Drum', 'REC/Play', 'Loop Stop', 'Tuner',
] as const;

const SET_GLOBAL = 0x11;
const FACTORY_RESET = 0x3f;
const EXP_REGISTER = 0x17;
const FS_REGISTER = 0x16;

function checkRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number ${min}..${max}`);
}

export function setGlobal(setting: GlobalSetting, value: number): Uint8Array {
  const spec: SettingSpec = GLOBAL_SETTINGS[setting];
  checkRange(setting, value, spec.min, spec.max);
  const u = value >>> 0;
  return buildFrame([MessageType.SET, SET_GLOBAL, ...spec.address, 0, 0, u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, u >>> 24]);
}

/**
 * Target of the external control. `exp`: the expression pedal; `fs`: a single footswitch;
 * `fs1` / `fs2`: the two functions of a dual footswitch. Not in the dump, so write-only.
 */
export function setExpFsTarget(slot: 'exp' | 'fs' | 'fs1' | 'fs2', value: number): Uint8Array {
  const targets = slot === 'exp' ? EXP_TARGETS : FS_TARGETS;
  checkRange(`${slot} target`, value, 0, targets.length - 1);
  const [register, sub] = ({ exp: [EXP_REGISTER, 0x01], fs: [FS_REGISTER, 0x00], fs1: [FS_REGISTER, 0x02], fs2: [FS_REGISTER, 0x04] } as const)[slot];
  return buildFrame([MessageType.SET, register, sub, value]);
}

const TARGET_LENGTH = 4;
const SETTING_LENGTH = 10;

/**
 * True only for a well-formed setting or EXP/FS target write (never the factory reset).
 * These are fire-and-forget like edits; SonicMaster sends them without waiting for a reply.
 */
export function isGlobalWrite(payload: Uint8Array): boolean {
  if (payload[0] !== MessageType.SET) return false;
  if (payload[1] === SET_GLOBAL) return payload.length === SETTING_LENGTH && Object.values(GLOBAL_SETTINGS).some((s) => s.address[0] === payload[2] && s.address[1] === payload[3]);
  if (payload[1] === EXP_REGISTER) return payload.length === TARGET_LENGTH && payload[2] === 0x01;
  if (payload[1] === FS_REGISTER) return payload.length === TARGET_LENGTH && [0x00, 0x02, 0x04].includes(payload[2] as number);
  return false;
}

/** Restores every setting and preset to factory state; the pedal reboots and drops the link. */
export function factoryReset(): Uint8Array {
  return buildFrame([MessageType.SET, FACTORY_RESET]);
}

/** Payload byte offsets of each value (one byte each; levels are signed). */
const OFFSET = {
  masterVolume: 22, backlight: 35, inputLevel: 40, fxRecLevel: 45, monitorLevel: 50,
  mode: 60, btRecLevel: 65, reamp: 70, eco: 75, expFsType: 80,
} as const;
const MIN_LENGTH = OFFSET.btRecLevel + 1;

/** Decodes the 12 10 reply payload; null when it is not one or is too short for the levels. */
export function decodeGlobals(payload: Uint8Array): GlobalSettings | null {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.GLOBALS || payload.length < MIN_LENGTH) return null;
  const signed = (o: number) => ((payload[o] as number) << 24) >> 24;
  const optional = (o: number) => (o < payload.length ? (payload[o] as number) : null);
  return {
    masterVolume: payload[OFFSET.masterVolume] as number,
    backlight: payload[OFFSET.backlight] as number,
    inputLevel: signed(OFFSET.inputLevel),
    fxRecLevel: signed(OFFSET.fxRecLevel),
    monitorLevel: signed(OFFSET.monitorLevel),
    mode: payload[OFFSET.mode] as number,
    btRecLevel: signed(OFFSET.btRecLevel),
    reamp: optional(OFFSET.reamp),
    eco: optional(OFFSET.eco),
    expFsType: optional(OFFSET.expFsType),
  };
}
