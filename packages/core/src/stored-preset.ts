/**
 * Reading a stored preset without loading it: 12 4F + uint32 index answers with the slot's record,
 * FF FF FF FF, a 16-byte name, then the same body the edit buffer (12 41) holds. Documented in
 * klotznick's Pocket Master Interoperability Guide (CC0); checked on the owner's V1.3.3 on
 * 2026-11-22 (P42's record equals its edit buffer), so backups read slots this way.
 */
import { decodePreset, type Preset } from './dump.ts';
import type { PocketMasterLink } from './link.ts';
import { MessageType, Query, queryFrame } from './queries.ts';

const PRESET_COUNT = 100;
const NAME_AT = 6; // 12 4F, then the 4-byte slot placeholder
const BODY_AT = NAME_AT + 16;

export const storedPresetArgs = (index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= PRESET_COUNT) throw new Error(`preset index must be 0..${PRESET_COUNT - 1}`);
  return [index & 0xff, (index >>> 8) & 0xff, 0, 0];
};

export function storedPresetFrame(index: number): Uint8Array {
  return queryFrame(Query.STORED_PRESET, storedPresetArgs(index));
}

/** A 12 4F reply as the 12 41 payload of the same preset, the form backups and decodePreset take. */
export function storedAsEditBuffer(payload: Uint8Array): Uint8Array {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.STORED_PRESET || payload.length <= BODY_AT) {
    throw new Error('not a stored-preset reply (expected payload 12 4F …)');
  }
  return Uint8Array.from([MessageType.GET, Query.EDIT_BUFFER, ...payload.subarray(BODY_AT)]);
}

export function decodeStoredPreset(payload: Uint8Array): { name: string; preset: Preset } {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.STORED_PRESET || payload.length <= BODY_AT) {
    throw new Error('not a stored-preset reply (expected payload 12 4F …)');
  }
  const name = String.fromCharCode(...payload.subarray(NAME_AT, BODY_AT))
    .replace(/\0.*$/s, '')
    .trim();
  return { name, preset: decodePreset(Uint8Array.from([MessageType.GET, Query.EDIT_BUFFER, ...payload.subarray(BODY_AT)])) };
}

export async function readStoredPreset(link: PocketMasterLink, index: number): Promise<{ name: string; preset: Preset; payload: Uint8Array }> {
  const { payload } = await link.request(Query.STORED_PRESET, storedPresetArgs(index));
  return { ...decodeStoredPreset(payload), payload };
}
