import { MessageType, Query } from './queries.ts';

export const USER_PRESETS = 50;
export const PRESET_COUNT = 100;

/** 0..49 are user presets P01..P50, 50..99 factory presets F01..F50. */
export function presetLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= PRESET_COUNT) {
    throw new Error(`preset index must be 0..${PRESET_COUNT - 1}, got ${index}`);
  }
  const user = index < USER_PRESETS;
  const n = user ? index + 1 : index - USER_PRESETS + 1;
  return `${user ? 'P' : 'F'}${String(n).padStart(2, '0')}`;
}

/** Reply to 12 43: `12 43 index …`. */
export function decodeCurrentPreset(payload: Uint8Array): number {
  if (payload[0] !== MessageType.GET || payload[1] !== Query.CURRENT_PRESET || payload.length < 3) {
    throw new Error('not a current-preset reply (expected payload 12 43 …)');
  }
  return payload[2] as number;
}
