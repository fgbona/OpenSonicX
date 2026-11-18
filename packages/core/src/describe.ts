import { parseFrame } from './frame.ts';
import { MessageType } from './queries.ts';

const NAMES: Readonly<Record<number, string>> = {
  0x10: 'global settings',
  0x20: 'user IR names',
  0x24: 'captured profile names',
  0x40: 'preset names',
  0x41: 'edit buffer',
  0x43: 'current preset',
  0x45: 'modified flag',
  0x47: 'model changed',
  0x48: 'parameter changed',
  0x49: 'block on/off',
  0x4a: 'save preset',
};

/** Short human label for one SysEx message, for logs. */
export function describeMessage(sysex: Uint8Array): string {
  let frame;
  try {
    frame = parseFrame(sysex);
  } catch {
    return 'not a Pocket Master frame';
  }
  if (!frame.crcOk) return 'bad checksum';
  const packet = frame.total > 1 ? `packet ${frame.index + 1}/${frame.total}` : '';
  if (frame.total > 1 && frame.index > 0) return packet;
  const [type, command] = frame.payload;
  const name = NAMES[command ?? -1] ?? `command 0x${(command ?? 0).toString(16).padStart(2, '0')}`;
  const isQuery = type === MessageType.GET && frame.payload.length === 2;
  const label = type === MessageType.ACK ? 'acknowledge' : type === MessageType.SET ? `set ${name}` : isQuery ? `get ${name}` : name;
  return packet ? `${label}, ${packet}` : label;
}
