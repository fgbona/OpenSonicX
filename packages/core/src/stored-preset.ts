/**
 * Reading a stored preset without loading it: 12 4F + uint32 index answers with the slot's record,
 * FF FF FF FF, a 16-byte name, then the same body the edit buffer (12 41) holds. Documented in
 * klotznick's Pocket Master Interoperability Guide (CC0); not yet checked on the owner's unit, so
 * the editor keeps loading a slot to back it up until the probe confirms both reads agree.
 */
import { decodePreset, type Preset } from './dump.ts';
import type { PocketMasterLink } from './link.ts';
import { MessageType, Query, queryFrame } from './queries.ts';

const PRESET_COUNT = 100;
const NAME_AT = 6; // 12 4F, then the 4-byte slot placeholder
const BODY_AT = NAME_AT + 16;

const indexArgs = (index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= PRESET_COUNT) throw new Error(`preset index must be 0..${PRESET_COUNT - 1}`);
  return [index & 0xff, (index >>> 8) & 0xff, 0, 0];
};

export function storedPresetFrame(index: number): Uint8Array {
  return queryFrame(Query.STORED_PRESET, indexArgs(index));
}

export function decodeStoredPreset(payload: Uint8Array): { name: string; preset: Preset } {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.STORED_PRESET || payload.length <= BODY_AT) {
    throw new Error('not a stored-preset reply (expected payload 12 4F …)');
  }
  const name = String.fromCharCode(...payload.subarray(NAME_AT, BODY_AT)).replace(/\0.*$/s, '').trim();
  return { name, preset: decodePreset(Uint8Array.from([MessageType.GET, Query.EDIT_BUFFER, ...payload.subarray(BODY_AT)])) };
}

export async function readStoredPreset(link: PocketMasterLink, index: number): Promise<{ name: string; preset: Preset; payload: Uint8Array }> {
  const { payload } = await link.request(Query.STORED_PRESET, indexArgs(index));
  return { ...decodeStoredPreset(payload), payload };
}
