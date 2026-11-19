import type { Pedal } from './backup.ts';
import type { CloArrays } from './clo/generate.ts';
import { profileUploadBlob } from './clo/codec.ts';
import { irSamplesFromWav, irUploadBlob, UploadDomain } from './ir-upload.ts';
import type { PocketMasterLink } from './link.ts';
import { decodeCurrentPreset } from './presets.ts';
import { Query } from './queries.ts';
import { decodePresetNames, decodeSlotNames, savePreset, selectPreset, type SlotName } from './slots.ts';

/** After its acknowledge the pedal still needs a moment before it reports the new preset (V1.3.3: ~250 ms works). */
const SELECT_SETTLE_MS = 250;
const EDIT_SETTLE_MS = 100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Names of the five user IR slots (read only). */
export async function readUserIrNames(link: PocketMasterLink): Promise<SlotName[]> {
  return decodeSlotNames((await link.request(Query.USER_IR_NAMES)).payload);
}

/** Names of the five captured-profile (clone) slots (read only). */
export async function readProfileNames(link: PocketMasterLink): Promise<SlotName[]> {
  return decodeSlotNames((await link.request(Query.CAPTURED_PROFILE_NAMES)).payload);
}

/** The Pedal contract (backup, save, restore flows) over a link. */
export function linkPedal(link: PocketMasterLink): Pedal {
  return {
    async readCurrentIndex() {
      return decodeCurrentPreset((await link.request(Query.CURRENT_PRESET)).payload);
    },
    async readEditBuffer() {
      return (await link.request(Query.EDIT_BUFFER)).payload;
    },
    async readNames() {
      return decodePresetNames((await link.request(Query.PRESET_NAMES)).payload);
    },
    async selectPreset(index) {
      const ok = await link.presetOperation(selectPreset(index));
      if (!ok) throw new Error(`the pedal refused to load preset ${index + 1}`);
      await wait(SELECT_SETTLE_MS);
    },
    async sendEdits(commands) {
      if (commands.length === 0) return;
      commands.forEach((bytes) => link.edit(bytes));
      await link.drained();
      await wait(EDIT_SETTLE_MS);
    },
    async savePreset(index, name) {
      return link.presetOperation(savePreset(index, name));
    },
  };
}

/**
 * Writes a WAV into user IR `slot` (0..4) as the official tool does: open the edit session, read
 * the IR names (the IR context), upload, then read the names again to check the slot took the name.
 * The pedal cannot send an IR back, so what the slot held before is lost.
 */
export async function uploadUserIr(link: PocketMasterLink, slot: number, name: string, wav: Uint8Array): Promise<SlotName[]> {
  const blob = irUploadBlob(slot, name, irSamplesFromWav(wav)); // validates before anything is sent
  await link.enterSession();
  await readUserIrNames(link);
  await link.upload(blob, UploadDomain.IR);
  const names = await readUserIrNames(link);
  if (names[slot]?.name !== name) throw new Error(`the IR was written, but User IR ${slot + 1} reports the name "${names[slot]?.name ?? ''}" instead of "${name}"`);
  return names;
}

/**
 * Writes a converted capture into profile `slot` (0..4) under `name` (1..15 characters): open
 * the edit session, read the profile names (the clone context), upload, then read the names
 * again to check the slot took the name. The pedal cannot send a profile back.
 */
export async function uploadUserProfile(link: PocketMasterLink, slot: number, name: string, arrays: CloArrays): Promise<SlotName[]> {
  const blob = profileUploadBlob(slot, name, arrays); // validates before anything is sent
  await link.enterSession();
  await readProfileNames(link);
  await link.upload(blob, UploadDomain.PROFILE);
  const names = await readProfileNames(link);
  if (names[slot]?.name !== name) throw new Error(`the profile was written, but slot ${slot + 1} reports the name "${names[slot]?.name ?? ''}" instead of "${name}"`);
  return names;
}
