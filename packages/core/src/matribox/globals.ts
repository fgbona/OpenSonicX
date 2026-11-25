/**
 * The Matribox II Pro's global settings (docs/matribox.md, "Global settings"), decoded from the
 * official editor's global settings window (captures mb-30 … mb-39, 2026-11-25).
 *
 * - The general table: flag 0, cmd 0x11, no argument; 52 bytes, one byte per setting.
 * - One setting: flag 1, cmd 0x11, `00 <id> 00 00` + i32 value; the unit echoes it. The unit sends
 *   the same message by itself when the setting changes on the unit (capture 2: Current Mode).
 * - The global EQ table: flag 0, cmd 0x16, no argument; 31 float32 LE.
 * - One EQ value: flag 2, cmd 0x16, u32 word index into that table + f32; the unit echoes it.
 * - The EQ switch: flag 1, cmd 0x16, `01 00 00 16` + u32 0/1, read with the same argument; the unit
 *   answers both with `00 00 00 00` + u32, not an echo.
 *
 * Only the settings whose write was captured can be written. Builders are byte-exact with the captured
 * host frames (test/fixtures/matribox-globals.txt).
 */
import { buildMbFrame, float32LE, MB_WRITE, readFloat32LE } from './frame.ts';
import type { MatriboxLink } from './link.ts';
import { mbRequest, wrapMbMessage } from './message.ts';

const GENERAL_CMD = 0x11;
const EQ_CMD = 0x16;
export const MB_GENERAL_SIZE = 52;
export const MB_EQ_SIZE = 124;

/**
 * Each setting whose write was captured: its id (the write's second byte), its byte in the general
 * table and the values it may be written with. MIDI In Source 0 ("TRS Only") is left out: the
 * editor's Control Changes (tuner, tempo) come over USB and would stop.
 */
export const MB_GLOBALS = {
  /** dB, -20..+20 (manual); +5 captured (mb-30), negatives as two-complement. */
  inputLevel: { id: 0x21, at: 14, min: -20, max: 20 },
  /**
   * 0..100 (mb-31). Its byte is 47, not 11: both went from their first values to 80 while AUX Level
   * (0 for the owner) and Brightness (the manual's 50) were changed; 47 was the 0.
   */
  auxLevel: { id: 0x24, at: 47, min: 0, max: 100 },
  /** 0 A.GT, 1 E.GT, 2 Line (the manual's order; 1 and 2 seen). */
  inputMode: { id: 0x22, at: 15, min: 0, max: 2 },
  /** Footswitch mode: 0 Preset, 1 Stomp. */
  currentMode: { id: 0x52, at: 35, min: 0, max: 1 },
  /** MIDI Input Ch (USB): 0 Omni, 1..16. */
  midiChannelUsb: { id: 0x61, at: 36, min: 0, max: 16 },
  /** MIDI In Source: 0 TRS Only (read only), 1 USB Only, 2 Mixed. */
  midiSource: { id: 0x62, at: 44, min: 1, max: 2 },
} as const;
export type MbGlobalSetting = keyof typeof MB_GLOBALS;

/**
 * Global Tempo: read, not written (mb-37 holds only the unit's notices, `00 26 00 00` + u32 BPM, sent
 * while the tempo is turned on the unit; no host write). Bytes 48..49 u16 BPM (FFFF while never set), 50 on.
 */
export const MB_GLOBAL_TEMPO_ID = 0x26;
const TEMPO_AT = 48;
const TEMPO_ON_AT = 50;
const NO_TEMPO = 0xffff;

export type MbGlobals = { readonly [K in MbGlobalSetting]: number } & {
  /** Global Tempo (read only): on, and its BPM (null while never set). */
  readonly tempo: { readonly on: boolean; readonly bpm: number | null };
};

export interface MbEqBand {
  readonly on: boolean;
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
}

export interface MbGlobalEq {
  /** 0..100. */
  readonly level: number;
  readonly lowCut: MbEqBand;
  /** Bands 1..4. */
  readonly bands: readonly MbEqBand[];
  readonly highCut: MbEqBand;
}

export interface MbGlobalState {
  readonly general: MbGlobals;
  readonly eq: MbGlobalEq;
  readonly eqOn: boolean;
}

/** Word of the low cut's switch; each group is switch, frequency, Q, gain: low cut, bands 1..4, high cut. */
const FIRST_GROUP = 3;
const GROUP = 4;
const GAIN = 3;
const LEVEL_WORD = 30;
export const MB_EQ_BANDS = 4;
const GAIN_DB = 20;
const PERCENT = 100;
const EQ_SWITCH = [0x01, 0x00, 0x00, 0x16] as const;

const fail = (msg: string): never => {
  throw new RangeError(`Matribox global: ${msg}`);
};
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const inRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

/** The general table read. */
export const mbReadGlobals = (): Uint8Array => mbRequest(0, GENERAL_CMD);
/** The global EQ table read. */
export const mbReadGlobalEq = (): Uint8Array => mbRequest(0, EQ_CMD);
/** The global EQ switch read. */
export const mbReadGlobalEqOn = (): Uint8Array => mbRequest(1, EQ_CMD, EQ_SWITCH);

/** One global setting: `00 <id> 00 00` + i32 (captures mb-30, mb-31, mb-33 … mb-36). */
export function mbSetGlobal(setting: MbGlobalSetting, value: number): Uint8Array {
  const { id, min, max } = MB_GLOBALS[setting];
  if (!Number.isInteger(value) || !inRange(value, min, max)) fail(`${setting} must be an integer ${min}..${max}, got ${value}`);
  return buildMbFrame(MB_WRITE, wrapMbMessage(1, GENERAL_CMD, [0x00, id, 0x00, 0x00, ...le32(value)]));
}

const eqWrite = (word: number, value: number) => buildMbFrame(MB_WRITE, wrapMbMessage(2, EQ_CMD, [...le32(word), ...float32LE(value)]));

/** The gain of EQ band `band` (0..3 = bands 1..4), -20..+20 dB (capture mb-38: band 2, +3 dB). */
export function mbSetGlobalEqGain(band: number, gain: number): Uint8Array {
  if (!Number.isInteger(band) || !inRange(band, 0, MB_EQ_BANDS - 1)) fail(`EQ band must be 0..${MB_EQ_BANDS - 1}, got ${band}`);
  if (!inRange(gain, -GAIN_DB, GAIN_DB)) fail(`EQ gain must be -${GAIN_DB}..${GAIN_DB} dB, got ${gain}`);
  return eqWrite(FIRST_GROUP + (band + 1) * GROUP + GAIN, gain);
}

/** The global EQ's level, 0..100 (capture mb-39). */
export function mbSetGlobalEqLevel(level: number): Uint8Array {
  if (!inRange(level, 0, PERCENT)) fail(`EQ level must be 0..${PERCENT}, got ${level}`);
  return eqWrite(LEVEL_WORD, level);
}

/** The global EQ's switch (capture mb-39): answered with `00 00 00 00` + u32, not echoed (mbWriteGlobalEqOn). */
export const mbSetGlobalEqOn = (on: boolean): Uint8Array => buildMbFrame(MB_WRITE, wrapMbMessage(1, EQ_CMD, [...EQ_SWITCH, ...le32(on ? 1 : 0)]));

const isEqOnAnswer = (data: Uint8Array) => data.length === 8 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0;

/** The unit's answer to the EQ switch read or write: `00 00 00 00` + u32. */
export function parseMbGlobalEqOn(data: Uint8Array): boolean {
  if (!isEqOnAnswer(data)) throw new Error('not the global EQ switch answer (00 00 00 00 + u32)');
  return new DataView(data.buffer, data.byteOffset, 8).getUint32(4, true) !== 0;
}

/** The general table (52 bytes). */
export function parseMbGlobals(data: Uint8Array): MbGlobals {
  if (data.length !== MB_GENERAL_SIZE) throw new Error(`the global settings table must be ${MB_GENERAL_SIZE} bytes, got ${data.length}`);
  const byte = (at: number) => data[at] as number;
  const tempo = byte(TEMPO_AT) | (byte(TEMPO_AT + 1) << 8);
  return {
    inputLevel: (byte(MB_GLOBALS.inputLevel.at) << 24) >> 24,
    auxLevel: byte(MB_GLOBALS.auxLevel.at),
    inputMode: byte(MB_GLOBALS.inputMode.at),
    currentMode: byte(MB_GLOBALS.currentMode.at),
    midiChannelUsb: byte(MB_GLOBALS.midiChannelUsb.at),
    midiSource: byte(MB_GLOBALS.midiSource.at),
    tempo: { on: byte(TEMPO_ON_AT) !== 0, bpm: tempo === NO_TEMPO ? null : tempo },
  };
}

/** The global EQ table (124 bytes). */
export function parseMbGlobalEq(data: Uint8Array): MbGlobalEq {
  if (data.length !== MB_EQ_SIZE) throw new Error(`the global EQ table must be ${MB_EQ_SIZE} bytes, got ${data.length}`);
  const word = (i: number) => readFloat32LE(data, i * 4);
  const group = (g: number): MbEqBand => {
    const at = FIRST_GROUP + g * GROUP;
    return { on: word(at) !== 0, frequency: word(at + 1), q: word(at + 2), gain: word(at + GAIN) };
  };
  return { level: word(LEVEL_WORD), lowCut: group(0), bands: Array.from({ length: MB_EQ_BANDS }, (_, i) => group(i + 1)), highCut: group(MB_EQ_BANDS + 1) };
}

/** The three global reads, as the official editor sends them on connect. */
export async function mbReadGlobalState(link: MatriboxLink): Promise<MbGlobalState> {
  const general = parseMbGlobals(await link.ask(mbReadGlobals(), (d) => d.length === MB_GENERAL_SIZE));
  const eq = parseMbGlobalEq(await link.ask(mbReadGlobalEq(), (d) => d.length === MB_EQ_SIZE));
  const eqOn = parseMbGlobalEqOn(await link.ask(mbReadGlobalEqOn(), isEqOnAnswer));
  return { general, eq, eqOn };
}

/** Switches the global EQ and checks the unit's answer holds the new state. */
export async function mbWriteGlobalEqOn(link: MatriboxLink, on: boolean): Promise<void> {
  if (parseMbGlobalEqOn(await link.ask(mbSetGlobalEqOn(on), isEqOnAnswer)) !== on) throw new Error(`the Matribox did not switch the global EQ ${on ? 'on' : 'off'}`);
}
