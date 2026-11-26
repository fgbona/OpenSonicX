/**
 * A `.clo` into one of the Matribox II Pro's 10 Clone (capture) slots, as Sonicake's official editor
 * uploads it (capture mb-19, docs/matribox.md "Capture (clone)"): flag 1, cmd 0x18, 8872 bytes =
 * u32 slot, u32 0, u32 byte sum of the `.clo`, a 20-byte NUL-padded name, the 8840-byte `.clo`, sent
 * as 49 literal pages and acknowledged with flag 3, cmd 0x18, `u32 slot, u32 status, u32 0`
 * (1 = stored). The rename (flag 2, cmd 0x18: u32 slot + 20-byte name, no answer) and the layout of
 * both come from waveod's firmware rebuild (src/editor/media_msgs.c, studio protocol.py; MIT,
 * Marcos Medeiros). Never sent here: the clone delete (flag 1, cmd 0x11, sub 0x9000 | n) and the
 * bootloader restart; this module has no builder for either.
 */
import { decodeClo } from '../clo/codec.ts';
import { buildMbFrame, buildMbFrames, MB_WRITE } from './frame.ts';
import type { MatriboxLink } from './link.ts';
import { MB_CLONE_SLOTS, mbReadCloneNames, parseMbCloneNames, wrapMbMessage } from './message.ts';

const CLONE_CMD = 0x18;
const UPLOAD_FLAG = 1;
const RENAME_FLAG = 2;
const NAME_FIELD = 20;
const NAME_MAX = 16;
const STORED = 1;
/** The unit writes the capture to flash before it answers: more than a parameter write takes. */
export const MB_CLONE_UPLOAD_TIMEOUT_MS = 10_000;

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MB_CLONE_SLOTS) throw new RangeError(`clone slot must be 0..${MB_CLONE_SLOTS - 1}, got ${slot}`);
}

/** Printable ASCII, 1..16 characters, as the clone name table shows it. */
export function checkMbCloneName(name: string): string {
  if (!/^[\x20-\x7e]{1,16}$/.test(name) || name.trim() === '') throw new RangeError(`clone name must be 1..${NAME_MAX} printable ASCII characters, got "${name}"`);
  return name;
}

/** The default name of an empty clone slot n (0-based), as the unit lists it. */
export const mbDefaultCloneName = (slot: number): string => `Clone ${slot + 1}`;

const nameField = (name: string) => {
  const field = new Uint8Array(NAME_FIELD);
  field.set(Array.from(checkMbCloneName(name), (c) => c.charCodeAt(0)));
  return field;
};

/** The decompressed data of the upload of `clo` (a whole .clo: checked) into clone `slot` (0..9) under `name`. */
export function mbCloneUploadData(slot: number, name: string, clo: Uint8Array): Uint8Array {
  checkSlot(slot);
  decodeClo(clo); // size, magic and CRC: the unit would store anything
  const data = new Uint8Array(32 + clo.length);
  const view = new DataView(data.buffer);
  view.setUint32(0, slot, true);
  view.setUint32(8, clo.reduce((sum, b) => sum + b, 0), true);
  data.set(nameField(name), 12);
  data.set(clo, 32);
  return data;
}

/** The 49 frames of the upload (literal LZO1X, 183-byte pages). */
export function mbCloneUpload(slot: number, name: string, clo: Uint8Array): Uint8Array[] {
  return buildMbFrames(MB_WRITE, wrapMbMessage(UPLOAD_FLAG, CLONE_CMD, mbCloneUploadData(slot, name, clo)));
}

/** The rename of clone `slot` (0..9): one write frame the unit does not answer (check it by reading the names). */
export function mbRenameClone(slot: number, name: string): Uint8Array {
  checkSlot(slot);
  const data = new Uint8Array(4 + NAME_FIELD);
  new DataView(data.buffer).setUint32(0, slot, true);
  data.set(nameField(name), 4);
  return buildMbFrame(MB_WRITE, wrapMbMessage(RENAME_FLAG, CLONE_CMD, data));
}

export type MbCloneStep = 'sending' | 'stored' | 'renaming' | 'checked';

export interface MbCloneUploadOptions {
  /** The slot's name; without it the upload is named "Capture n" and no rename is sent. */
  readonly name?: string;
  readonly onProgress?: (step: MbCloneStep) => void;
  readonly timeoutMs?: number;
}

/**
 * Uploads `clo` into clone `slot` (0-based), checks the unit stored it (status 1), renames the slot
 * when a name is given and reads the names back to check it. Overwriting a slot cannot be undone
 * (the unit cannot send a capture back): callers confirm with the person first. Resolves with the
 * clone names as the unit lists them afterwards.
 */
export async function mbUploadClone(link: MatriboxLink, slot: number, clo: Uint8Array, options: MbCloneUploadOptions = {}): Promise<readonly string[]> {
  const { name, onProgress, timeoutMs = MB_CLONE_UPLOAD_TIMEOUT_MS } = options;
  const frames = mbCloneUpload(slot, name ?? `Capture ${slot + 1}`, clo); // everything checked before sending
  onProgress?.('sending');
  const ack = await link.upload(frames, timeoutMs);
  const status = ack.length >= 8 ? new DataView(ack.buffer, ack.byteOffset, ack.byteLength).getUint32(4, true) : -1;
  if (status !== STORED) throw new Error(`Matribox II PRO did not store the capture in CLONE ${slot + 1} (status ${status})`);
  onProgress?.('stored');
  if (name !== undefined) {
    onProgress?.('renaming');
    link.post(mbRenameClone(slot, name));
  }
  const names = parseMbCloneNames(await link.read(mbReadCloneNames()));
  if (name !== undefined && names[slot]?.trim() !== name.trim()) throw new Error(`CLONE ${slot + 1} shows "${names[slot]?.trim() ?? ''}" after the upload, not "${name.trim()}"`);
  onProgress?.('checked');
  return names;
}
