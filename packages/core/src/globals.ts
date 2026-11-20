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
  /**
   * The settings below are null when the reply has no record for them: firmware V1.3.3 reports
   * levels, mode, backlight and power-off confirm, but not re-amp, ECO or the EXP/FS jack type.
   */
  /** Levels in dB, -20..20. */
  readonly inputLevel: number | null;
  readonly fxRecLevel: number | null;
  readonly monitorLevel: number | null;
  readonly btRecLevel: number | null;
  readonly backlight: number | null;
  /** USB recording: 0 dry, 1 wet. V1.3.3 reports it but ignores writes. */
  readonly mode: number | null;
  readonly powerConfirm: number | null;
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

/**
 * Decodes the 12 10 reply: after the two command bytes, records of `<a0 a1> <length u16 LE>
 * <value>`, matched to settings by address (levels are signed bytes). SonicMaster reads fixed
 * byte offsets, which on V1.3.3 put the power-off confirm record where re-amp was expected.
 * Null when the reply is not one or has no master volume record.
 */
export function decodeGlobals(payload: Uint8Array): GlobalSettings | null {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.GLOBALS) return null;
  const values = new Map<string, Uint8Array>();
  for (let o = 2; o + 4 <= payload.length; ) {
    const length = (payload[o + 2] as number) | ((payload[o + 3] as number) << 8);
    if (o + 4 + length > payload.length) break;
    values.set(`${payload[o]}:${payload[o + 1]}`, payload.subarray(o + 4, o + 4 + length));
    o += 4 + length;
  }
  const raw = (setting: GlobalSetting) => values.get(GLOBAL_SETTINGS[setting].address.join(':'));
  // Values are little-endian; every setting fits its first byte (master volume's record is 4 bytes).
  const byte = (setting: GlobalSetting) => raw(setting)?.[0] ?? null;
  const level = (setting: GlobalSetting) => { const b = byte(setting); return b === null ? null : (b << 24) >> 24; };
  const masterVolume = byte('masterVolume');
  if (masterVolume === null) return null;
  return {
    masterVolume,
    inputLevel: level('inputLevel'), fxRecLevel: level('fxRecLevel'), monitorLevel: level('monitorLevel'), btRecLevel: level('btRecLevel'),
    backlight: byte('backlight'), mode: byte('mode'), powerConfirm: byte('powerConfirm'),
    reamp: byte('reamp'), eco: byte('eco'), expFsType: byte('expFsType'),
  };
}
