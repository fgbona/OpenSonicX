/**
 * Matribox II Pro MIDI Control Change numbers, restated from the "MIDI Control Information List" of
 * Sonicake's manual (firmware V1.2.2). Plain 3-byte Control Change messages on the unit's MIDI
 * channel (global setting: Omni or 1..16; its "MIDI In Source" must include USB) over the same USB
 * MIDI port as the SysEx. The unit sends no answer to them. Not yet tried on the owner's unit.
 *
 * Switches read 0..63 as off (stop, post) and 64..127 as on (play, pre); the rest act on any value.
 */
export const MB_CC = {
  bankMsb: 0, // 0 = 1A..30D, 1 = 31A..60D, with a Program Change 0..119
  presetVolume: 7, // 0..100
  exp1: 11, // 0..100
  exp1Mode: 13, // switch: A / B
  quickKnob1: 16, // 0..100; quickKnob1 + 1 steps it down (0..63) or up (64..127)
  quickKnob2: 18,
  quickKnob3: 20,
  bankUp: 22,
  bankDown: 23,
  presetUp: 24,
  presetDown: 25,
  footswitchMode: 29, // switch: preset mode / stomp mode
  moduleOn1: 43, // switch per block 1..12: 43..54
  tuner: 58, // switch
  looper: 59, // switch
  looperRecord: 60,
  looperAutoRecord: 61,
  looperPlay: 62, // switch: stop / play
  looperUndo: 63, // undo / redo
  looperDelete: 64,
  looperRecordVolume: 65, // 0..100
  looperPlaybackVolume: 66, // 0..100
  looperPlacement: 67, // switch: post / pre
  bpmMsb: 68, // with bpmLsb: BPM = msb·128 + lsb, 40..300
  bpmLsb: 69,
  tapTempo: 70,
  ctrl1: 71, // ctrl1..ctrl4: 71..74
  drumMenu: 92, // switch
  drumPlay: 93, // switch: stop / play
  drumRhythm: 94, // 0..99
  drumVolume: 95, // 0..100
} as const;

export const MB_BPM_MIN = 40;
export const MB_BPM_MAX = 300;
/** A switch CC's value: 127 on, 0 off. */
export const mbSwitch = (on: boolean): number => (on ? 127 : 0);

const fail = (msg: string): never => {
  throw new RangeError(`Matribox CC: ${msg}`);
};
const isIn = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/** A Control Change message: `Bn cc value`, channel 1..16. */
export function mbControlChange(channel: number, cc: number, value: number): Uint8Array {
  if (!isIn(channel, 1, 16)) fail(`MIDI channel must be 1..16, got ${channel}`);
  if (!isIn(cc, 0, 127)) fail(`controller must be 0..127, got ${cc}`);
  if (!isIn(value, 0, 127)) fail(`value must be an integer 0..127, got ${value}`);
  return Uint8Array.of(0xb0 | (channel - 1), cc, value);
}

/** The loaded preset's tempo: CC 68 (MSB) then CC 69 (LSB). */
export function mbBpmControlChanges(channel: number, bpm: number): Uint8Array[] {
  if (!isIn(bpm, MB_BPM_MIN, MB_BPM_MAX)) fail(`BPM must be an integer ${MB_BPM_MIN}..${MB_BPM_MAX}, got ${bpm}`);
  return [mbControlChange(channel, MB_CC.bpmMsb, bpm >> 7), mbControlChange(channel, MB_CC.bpmLsb, bpm & 0x7f)];
}

/** Whether `bytes` is one Control Change message (what the link's control() sends). */
export const isMbControlChange = (bytes: Uint8Array): boolean => bytes.length === 3 && (bytes[0] as number) >> 4 === 0xb && (bytes[1] as number) < 0x80 && (bytes[2] as number) < 0x80;
