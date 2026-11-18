/**
 * Backup, save and restore flows (phase 3). They only use the Pedal interface, so they run the
 * same in the browser, in the MCP server and against the fake pedal in the tests.
 *
 * The pedal only dumps the loaded preset, so reading another slot means selecting it, which
 * discards unsaved edits. Every flow therefore carries the edits: it returns to the slot that was
 * loaded and sends the diff that brings the edit buffer back to the edited preset.
 */
import { decodePreset, modelOf, type Preset } from './dump.ts';
import { diffPresets, editToCommands, applyEdit } from './edit.ts';
import { fromHex, toHex } from './hex.ts';
import { presetLabel, USER_PRESETS } from './presets.ts';
import { savePreset } from './slots.ts';

export interface Pedal {
  readCurrentIndex(): Promise<number>;
  /** Edit-buffer dump payload (reply to 12 41). */
  readEditBuffer(): Promise<Uint8Array>;
  readNames(): Promise<string[]>;
  /** Sends 11 43 and resolves once the pedal has loaded the preset. */
  selectPreset(index: number): Promise<void>;
  /** Sends live-edit commands in order and resolves once they are written. */
  sendEdits(commands: Uint8Array[]): Promise<void>;
  /** Sends 11 4A; resolves true on 14 08 00, false on 14 08 01, rejects without an acknowledge. */
  savePreset(index: number, name: string): Promise<boolean>;
}

export interface SlotBackup {
  readonly index: number;
  readonly label: string;
  readonly name: string;
  /** Raw edit-buffer dump payload in hex: everything the pedal reported, decoded or not. */
  readonly payload: string;
}

export interface BackupFile {
  readonly format: 'pocket-master-backup';
  readonly version: 1;
  readonly kind: 'session' | 'slot';
  readonly createdAt: string;
  readonly slots: readonly SlotBackup[];
}

export interface Progress {
  readonly step: string;
  readonly done: number;
  readonly total: number;
}

interface FlowOptions {
  onProgress?: (p: Progress) => void;
  /** Called as soon as a backup exists, so it is kept even if a later step fails. */
  onBackup?: (file: BackupFile) => void;
  now?: () => Date;
}

const backupFile = (kind: BackupFile['kind'], slots: SlotBackup[], now: () => Date): BackupFile => ({
  format: 'pocket-master-backup', version: 1, kind, createdAt: now().toISOString(), slots,
});

async function readSlot(pedal: Pedal, index: number, name: string): Promise<SlotBackup> {
  await pedal.selectPreset(index);
  const loaded = await pedal.readCurrentIndex();
  if (loaded !== index) {
    throw new Error(`asked for ${presetLabel(index)} but the pedal loaded ${presetLabel(loaded)}; backup stopped`);
  }
  const payload = await pedal.readEditBuffer();
  decodePreset(payload); // refuse to keep a dump the editor cannot read
  return { index, label: presetLabel(index), name, payload: toHex(payload).replace(/ /g, '') };
}

/** Brings the edit buffer to `target` by diff and checks it took. */
async function applyPreset(pedal: Pedal, target: Preset): Promise<void> {
  const fresh = decodePreset(await pedal.readEditBuffer());
  const { commands } = diffPresets(fresh, target).reduce(
    (acc, e) => ({ state: applyEdit(acc.state, e), commands: [...acc.commands, ...editToCommands(acc.state, e)] }),
    { state: fresh, commands: [] as Uint8Array[] },
  );
  await pedal.sendEdits(commands);
  const check = decodePreset(await pedal.readEditBuffer());
  if (diffPresets(check, target).length > 0) throw new Error('the pedal did not take every edit; nothing was saved');
}

/** Runs `fn` (which may select other slots), then returns to `original` and restores `edited`. */
async function carryEdits<T>(pedal: Pedal, original: number, edited: Preset | null, fn: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    try {
      await restoreLoaded(pedal, original, edited);
    } catch (restoreError) {
      console.error('could not return to the original preset', restoreError);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason}. The pedal may not be back on ${presetLabel(original)}, and unsaved edits may be lost.`);
    }
    throw error;
  }
  await restoreLoaded(pedal, original, edited);
  return result;
}

async function restoreLoaded(pedal: Pedal, original: number, edited: Preset | null): Promise<void> {
  await pedal.selectPreset(original);
  const loaded = await pedal.readCurrentIndex();
  if (loaded !== original) throw new Error(`could not return to ${presetLabel(original)}; the pedal is on ${presetLabel(loaded)}`);
  if (edited) await applyPreset(pedal, edited);
}

/**
 * Reads every user slot (P01..P50) and returns to the loaded preset with its edits.
 * Not part of the save flow (the owner chose target-only backups); kept for a future
 * "back up all presets" action and for the MCP server.
 */
export async function backupAllSlots(
  pedal: Pedal,
  options: FlowOptions & { edited: Preset | null },
): Promise<BackupFile> {
  const now = options.now ?? (() => new Date());
  const original = await pedal.readCurrentIndex();
  const names = await pedal.readNames();
  const slots = await carryEdits(pedal, original, options.edited, async () => {
    const out: SlotBackup[] = [];
    for (let index = 0; index < USER_PRESETS; index++) {
      options.onProgress?.({ step: `Backing up ${presetLabel(index)}`, done: index, total: USER_PRESETS });
      out.push(await readSlot(pedal, index, names[index] ?? ''));
    }
    return out;
  });
  const file = backupFile('session', slots, now);
  options.onBackup?.(file);
  return file;
}

export interface SaveResult {
  readonly saved: Preset;
  /** Null when the save ran with `backup: false`. */
  readonly targetBackup: BackupFile | null;
}

type SaveOptions = FlowOptions & {
  target: number;
  name: string;
  /** Back up the target slot before writing it. Default true; the user can opt out per save. */
  backup?: boolean;
};

/**
 * A block whose model the catalog does not know decodes without parameters. Re-creating it by
 * diff would select the model again, which resets its knobs to the pedal's defaults, and nothing
 * could notice. Refuse instead of silently changing the sound.
 */
function requireKnownModels(preset: Preset): void {
  const unknown = preset.chain.find((b) => modelOf(preset, b) === undefined);
  if (unknown) {
    const code = `0x${unknown.code.toString(16).toUpperCase().padStart(8, '0')}`;
    throw new Error(`${unknown.label} uses model ${code}, which this editor does not know yet; saving it would reset that block's settings`);
  }
}

/**
 * Saves the pedal's edit buffer to user slot `target` under `name`:
 * target backup (unless `backup: false`) → save → verify name and content.
 * `edited` is what the screen shows; the save is refused when the pedal no longer matches it
 * (for example after a knob was turned on the unit), so nothing is saved that the user did not see.
 */
export async function saveToSlot(pedal: Pedal, options: SaveOptions & { edited: Preset | null }): Promise<SaveResult> {
  savePreset(options.target, options.name); // validates slot and name before anything is sent
  const original = await pedal.readCurrentIndex();
  const onPedal = decodePreset(await pedal.readEditBuffer());
  if (options.edited && diffPresets(onPedal, options.edited).length > 0) {
    throw new Error("the pedal's preset differs from the screen (a knob turned on the unit?); click Read, check, then save");
  }
  requireKnownModels(onPedal);
  return saveEdited(pedal, options, original, onPedal);
}

async function saveEdited(pedal: Pedal, options: SaveOptions, original: number, edited: Preset): Promise<SaveResult> {
  const { target, name } = options;
  const now = options.now ?? (() => new Date());

  let targetBackup: BackupFile | null = null;
  if (options.backup !== false) {
    options.onProgress?.({ step: `Backing up ${presetLabel(target)}`, done: 0, total: 3 });
    const names = await pedal.readNames();
    const slot = await carryEdits(pedal, original, edited, () => readSlot(pedal, target, names[target] ?? ''));
    targetBackup = backupFile('slot', [slot], now);
    options.onBackup?.(targetBackup);
  }

  options.onProgress?.({ step: `Saving ${presetLabel(target)}`, done: 1, total: 3 });
  const ok = await pedal.savePreset(target, name);
  if (!ok) throw new Error(`the pedal reported that the save failed; ${presetLabel(target)} was not changed`);

  options.onProgress?.({ step: `Checking ${presetLabel(target)}`, done: 2, total: 3 });
  const savedName = (await pedal.readNames())[target];
  if (savedName !== name) throw new Error(`saved, but ${presetLabel(target)} is named "${savedName}" instead of "${name}"`);
  await pedal.selectPreset(target);
  const saved = decodePreset(await pedal.readEditBuffer());
  if (diffPresets(saved, edited).length > 0) throw new Error(`saved, but ${presetLabel(target)} differs from what was edited`);
  options.onProgress?.({ step: `Saved ${presetLabel(target)}`, done: 3, total: 3 });
  return { saved, targetBackup };
}

/**
 * Writes a backed-up slot back to its slot under its backed-up name. The slot's current content is
 * backed up first. Loads that slot, so unsaved edits on the loaded preset are discarded.
 */
export async function restoreFromBackup(
  pedal: Pedal,
  slot: SlotBackup,
  options: FlowOptions,
): Promise<SaveResult> {
  const name = slot.name || slot.label;
  savePreset(slot.index, name); // validates before the selection discards anything
  const preset = decodePreset(fromHex(slot.payload));
  requireKnownModels(preset);
  await pedal.selectPreset(slot.index);
  const loaded = await pedal.readCurrentIndex();
  if (loaded !== slot.index) throw new Error(`asked for ${slot.label} but the pedal loaded ${presetLabel(loaded)}; nothing was restored`);
  // A restore always backs up what it overwrites: it exists to undo, so it must be undoable too.
  return saveEdited(pedal, { ...options, target: slot.index, name, backup: true }, slot.index, preset);
}

/** Parses and checks a backup file. Throws a readable error for anything that is not one. */
export function parseBackupFile(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a Pocket Master backup file (invalid JSON)');
  }
  const file = data as Partial<BackupFile>;
  const validKind = file?.kind === 'session' || file?.kind === 'slot';
  const validTime = typeof file?.createdAt === 'string' && !Number.isNaN(Date.parse(file.createdAt));
  if (file?.format !== 'pocket-master-backup' || file.version !== 1 || !Array.isArray(file.slots) || !validKind || !validTime) {
    throw new Error('not a Pocket Master backup file');
  }
  for (const s of file.slots) {
    const label = Number.isInteger(s?.index) && s.index >= 0 && s.index < USER_PRESETS ? presetLabel(s.index) : '?';
    try {
      if (label === '?' || typeof s.name !== 'string' || typeof s.payload !== 'string') throw new Error('bad fields');
      if (s.name !== '') savePreset(s.index, s.name); // the name must be one the pedal accepts
      decodePreset(fromHex(s.payload));
    } catch {
      throw new Error(`backup file is damaged: slot ${label} cannot be read`);
    }
  }
  return file as BackupFile;
}
