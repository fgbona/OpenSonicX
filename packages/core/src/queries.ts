import { buildFrame, parseFrame, type Frame } from './frame.ts';

/** First payload byte: message type. */
export const MessageType = { SET: 0x11, GET: 0x12, ACK: 0x14 } as const;

/** Second payload byte of a GET query and of its reply. */
export const Query = {
  GLOBALS: 0x10,
  USER_IR_NAMES: 0x20,
  CAPTURED_PROFILE_NAMES: 0x24,
  PRESET_NAMES: 0x40,
  EDIT_BUFFER: 0x41,
  CURRENT_PRESET: 0x43,
  MODIFIED: 0x45,
} as const;
export type QueryKind = (typeof Query)[keyof typeof Query];

export function queryFrame(kind: QueryKind): Uint8Array {
  return buildFrame([MessageType.GET, kind]);
}

/** True only for a well-formed frame whose payload is a GET query. Anything else could write to the pedal. */
export function isReadOnly(sysex: Uint8Array): boolean {
  try {
    const f = parseFrame(sysex);
    return f.crcOk && f.payload[0] === MessageType.GET;
  } catch {
    return false;
  }
}

export function isReply(frame: Frame, kind: QueryKind): boolean {
  return frame.crcOk && frame.payload[0] === MessageType.GET && frame.payload[1] === kind;
}
