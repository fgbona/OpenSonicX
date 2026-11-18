import { buildFrame, parseFrame } from './frame.ts';
import { MessageType, Query } from './queries.ts';
import { PRESET_COUNT, USER_PRESETS } from './presets.ts';

/** Second payload byte of preset operations: they change which preset is loaded or what a slot holds. */
export const PresetCommand = { VOLUME: 0x42, SELECT: 0x43, SAVE: 0x4a } as const;
const CMD_ACK = 0x08;
export const NAME_LENGTH = 10;
const NAME_RECORD = 20; // u32 slot + char[16]
const SAVE_PAYLOAD = 2 + 4 + NAME_LENGTH + 3;

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** Loads a preset: 0..49 user P01..P50, 50..99 factory F01..F50. Discards unsaved edits on the pedal. */
export function selectPreset(index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= PRESET_COUNT) throw new Error(`preset index must be 0..${PRESET_COUNT - 1}`);
  return buildFrame([MessageType.SET, PresetCommand.SELECT, ...u32(index)]);
}

/** Volume of the loaded preset, 0..100. */
export function setPresetVolume(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('preset volume must be 0..100');
  return buildFrame([MessageType.SET, PresetCommand.VOLUME, 0x01, 0x20, 0x01, 0x00, value]);
}

/** 1..10 printable ASCII characters, zero padded to 10 bytes. */
export function encodeName(name: string): number[] {
  if (name.length < 1 || name.length > NAME_LENGTH) throw new Error(`preset names are 1..${NAME_LENGTH} characters`);
  const codes = Array.from(name, (c) => c.charCodeAt(0));
  if (codes.some((c) => c < 0x20 || c > 0x7e)) throw new Error('preset names must be plain ASCII (letters, digits, punctuation)');
  return [...codes, ...new Array<number>(NAME_LENGTH - codes.length).fill(0)];
}

/** Writes the edit buffer to user slot 0..49 (P01..P50) under a name. The pedal answers with an acknowledge. */
export function savePreset(index: number, name: string): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= USER_PRESETS) {
    throw new Error(`only user presets P01..P${USER_PRESETS} can be written`);
  }
  return buildFrame([MessageType.SET, PresetCommand.SAVE, ...u32(index), ...encodeName(name), 0, 0, 0]);
}

/** True only for a well-formed preset selection (0..99) or a save to a user slot (0..49). */
export function isPresetOperation(sysex: Uint8Array): boolean {
  try {
    const f = parseFrame(sysex);
    if (!f.crcOk || f.total !== 1 || f.payload[0] !== MessageType.SET) return false;
    const view = new DataView(f.payload.buffer, f.payload.byteOffset, f.payload.byteLength);
    if (f.payload[1] === PresetCommand.SELECT) return f.payload.length === 6 && view.getUint32(2, true) < PRESET_COUNT;
    if (f.payload[1] === PresetCommand.SAVE) return f.payload.length === SAVE_PAYLOAD && view.getUint32(2, true) < USER_PRESETS;
    return false;
  } catch {
    return false;
  }
}

/** Reply to 12 40: the 100 preset names, index 0..99. */
export function decodePresetNames(payload: Uint8Array): string[] {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.PRESET_NAMES) {
    throw new Error('not a preset-names reply (expected payload 12 40 …)');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const names = new Array<string>(PRESET_COUNT).fill('');
  for (let o = 2; o + NAME_RECORD <= payload.length; o += NAME_RECORD) {
    const index = view.getUint32(o, true);
    if (index >= PRESET_COUNT) break;
    names[index] = decodeName(payload.subarray(o + 4, o + NAME_RECORD));
  }
  return names;
}

function decodeName(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return Array.from(bytes.subarray(0, end < 0 ? bytes.length : end), (c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '?'))
    .join('')
    .trimEnd();
}

/** Acknowledge `14 08 00` is ok, `14 08 01` is a failure. */
export function decodeAck(payload: Uint8Array): boolean {
  if (payload[0] !== MessageType.ACK || payload[1] !== CMD_ACK || payload.length < 3) {
    throw new Error('not an acknowledge (expected payload 14 08 …)');
  }
  return payload[2] === 0;
}
