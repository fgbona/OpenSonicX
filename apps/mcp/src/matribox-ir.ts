/**
 * Loading a WAV into one of the Matribox II Pro's 20 user IR slots, as Sonicake's official editor
 * does (docs/matribox.md, "User IR upload"): the WAV converted to 1024 samples at 44.1 kHz, sent in
 * one paged message, acknowledged by the unit. The unit cannot send an IR back, so an occupied
 * slot (its name is not the default "User IR n") is only overwritten when asked.
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { MB_IR_SLOTS, mbIrUpload, mbReadIrNames, parseMbIrNames } from '@pocket-master/core';
import type { MatriboxConnection } from './devices.ts';
import { inside } from './session.ts';

export const MB_IR_UNCHECKED =
  "Experimental: the IR upload is rebuilt byte for byte from the official editor's uploads, and checked on one unit so far. Check the slot with matribox_list_irs and by ear.";
const NAME_MAX = 16;
const STORED = 1;

export interface MatriboxIrOptions {
  readonly file: string;
  /** 1-based, 1..20. */
  readonly slot: number;
  readonly confirm: string;
  readonly name?: string;
  readonly replace?: boolean;
}

const defaultSlotName = (slot: number) => `User IR ${slot}`;

/** The file name without folder and extension, printable ASCII, cut to 16 characters like the official editor. */
function nameFromFile(file: string): string {
  const name = basename(file, extname(file))
    .replace(/[^\x20-\x7e]/g, '_')
    .slice(0, NAME_MAX)
    .trim();
  return name === '' ? 'User IR' : name;
}

/** Checks everything that needs no unit, then returns the upload's frames and the name. */
export async function prepareMatriboxIr(irs: string, options: MatriboxIrOptions): Promise<{ frames: Uint8Array[]; name: string }> {
  const { slot } = options;
  if (!Number.isInteger(slot) || slot < 1 || slot > MB_IR_SLOTS) throw new Error(`slot must be 1..${MB_IR_SLOTS}, got ${slot}`);
  if (options.confirm?.trim().toUpperCase() !== `IR${slot}`) throw new Error(`confirm must be "IR${slot}" to write that slot`);
  if (!/\.wav$/i.test(options.file)) throw new Error(`an IR is a .wav file, got "${options.file}"`);
  const wav = new Uint8Array(await readFile(inside(irs, options.file)));
  const name = options.name ?? nameFromFile(options.file);
  return { frames: mbIrUpload(slot - 1, name, wav), name }; // the WAV, rate and name are checked here
}

/** Uploads into slot `slot` (refusing an occupied one unless `replace`), then reads the names back. */
export async function uploadMatriboxIr(unit: MatriboxConnection, slot: number, prepared: { frames: Uint8Array[]; name: string }, replace = false): Promise<string> {
  const before = parseMbIrNames(await unit.read(mbReadIrNames()));
  const current = before[slot - 1]?.trim() ?? '';
  const occupied = current !== '' && current !== defaultSlotName(slot);
  if (occupied && !replace) {
    throw new Error(`User IR ${slot} holds "${current}", which cannot be read back from the unit; keep its WAV, then pass replace: true to overwrite it`);
  }
  const ack = await unit.upload(prepared.frames);
  const status = ack.length >= 8 ? new DataView(ack.buffer, ack.byteOffset, ack.byteLength).getUint32(4, true) : -1;
  if (status !== STORED) throw new Error(`Matribox II PRO did not store the IR in User IR ${slot} (status ${status})`);
  const after = parseMbIrNames(await unit.read(mbReadIrNames()));
  if (after[slot - 1]?.trim() !== prepared.name.trim()) throw new Error(`User IR ${slot} shows "${after[slot - 1]?.trim() ?? ''}" after the upload, not "${prepared.name.trim()}"`);
  const list = after.map((n, i) => `User IR ${i + 1}: ${n.trim()}`).join('\n');
  return [`Loaded "${prepared.name.trim()}" into User IR ${slot}${occupied ? ` (replacing "${current}")` : ''}. Pick it in an IR block.`, MB_IR_UNCHECKED, '', list].join('\n');
}
