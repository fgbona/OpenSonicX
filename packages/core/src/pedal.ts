import { decodeGlobals, type GlobalSettings } from './globals.ts';
import type { Pedal } from './backup.ts';
import type { CloArrays } from './clo/generate.ts';
import { profileRenameBlob, profileUploadBlob } from './clo/codec.ts';
import { irRenameBlob, irSamplesFromWav, irUploadBlob, UploadDomain } from './ir-upload.ts';
import type { PocketMasterLink } from './link.ts';
import { diffPresets } from './edit.ts';
import { decodeCurrentPreset, presetLabel } from './presets.ts';
import { Query } from './queries.ts';
import { copyPreset, decodePresetNames, decodeSlotNames, savePreset, selectPreset, type SlotName } from './slots.ts';
import { readStoredPreset } from './stored-preset.ts';

/** After its acknowledge the pedal still needs a moment before it reports the new preset (V1.3.3: ~250 ms works). */
const SELECT_SETTLE_MS = 250;
const EDIT_SETTLE_MS = 100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Names of the five user IR slots (read only). */
export async function readUserIrNames(link: PocketMasterLink): Promise<SlotName[]> {
  return decodeSlotNames((await link.request(Query.USER_IR_NAMES)).payload);
}

/** Device-wide settings; throws when the reply is not one the decoder knows. */
export async function readGlobals(link: PocketMasterLink): Promise<GlobalSettings> {
  const globals = decodeGlobals((await link.request(Query.GLOBALS)).payload);
  if (!globals) throw new Error('The pedal answered the settings query with a reply this editor cannot read.');
  return globals;
}

/**
 * Copies stored preset `source` over user slot `destination` (the loaded preset is untouched),
 * then reads both back without loading them and checks the destination holds the source's sound.
 */
export async function copyStoredPreset(link: PocketMasterLink, destination: number, source: number): Promise<void> {
  const ok = await link.presetOperation(copyPreset(destination, source));
  if (!ok) throw new Error(`the pedal reported that the copy failed; ${presetLabel(destination)} was not changed`);
  const from = await readStoredPreset(link, source);
  const to = await readStoredPreset(link, destination);
  if (diffPresets(to.preset, from.preset).length > 0) throw new Error(`copied, but ${presetLabel(destination)} does not hold the same preset as ${presetLabel(source)}`);
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

async function renameSlot(link: PocketMasterLink, kind: 'ir' | 'profile', slot: number, name: string): Promise<SlotName[]> {
  const blob = kind === 'ir' ? irRenameBlob(slot, name) : profileRenameBlob(slot, name); // validates first
  const readNames = kind === 'ir' ? readUserIrNames : readProfileNames;
  await link.enterSession();
  await readNames(link);
  await link.upload(blob, kind === 'ir' ? UploadDomain.IR : UploadDomain.PROFILE);
  const names = await readNames(link);
  if (names[slot]?.name !== name) throw new Error(`renamed, but slot ${slot + 1} reports "${names[slot]?.name ?? ''}" instead of "${name}"`);
  return names;
}

/** Renames user IR `slot` (0..4) to `name` (1..10 characters); the IR itself is untouched. */
export const renameUserIr = (link: PocketMasterLink, slot: number, name: string) => renameSlot(link, 'ir', slot, name);

/** Renames profile `slot` (0..4) to `name` (1..15 characters); the profile itself is untouched. */
export const renameUserProfile = (link: PocketMasterLink, slot: number, name: string) => renameSlot(link, 'profile', slot, name);
