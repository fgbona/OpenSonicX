import { constants } from 'node:fs';
import type { Converter } from './convert.ts';
import type { Tone3000Store } from './tone3000-store.ts';
import { describeGlobals, globalWrites, type GlobalChanges } from './globals.ts';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  formatModels, formatPreset, toEdit, type Change,
  applyEdit, applyPreset, downloadModel, IR_SLOTS, irSamplesFromWav, irUploadBlob, listModels, parseNam, pollDeviceToken, profileUploadBlob, searchTones, startDeviceLogin, decodePreset, editToCommands, fromHex, loadIntoEditBuffer,
  parseBackupFile, parsePresetFile, parsePresetLabel, presetFile, presetLabel,
  backupAllSlots, backupStoredSlot, resolveBlock, restoreFromBackup, saveToSlot, USER_PRESETS,
  type BackupFile, type CloArrays, type GlobalSettings, type DeviceLogin, type Edit, type Tokens, type Pedal, type Preset, type SlotNames,
} from '@pocket-master/core';

export type { Change } from '@pocket-master/core';

/** What the session needs from the pedal: the core Pedal contract plus two read-only queries. */
export interface PedalIO extends Pedal {
  readSlotNames(): Promise<SlotNames>;
  /** The pedal's own "edit buffer differs from the slot" flag, null when unknown. */
  readModified(): Promise<boolean | null>;
  /** Writes a WAV into user IR `slot` (0..4) under `name`; resolves once it is in the pedal's memory. */
  uploadIr(slot: number, name: string, wav: Uint8Array): Promise<void>;
  /** Writes converted capture arrays into profile `slot` (0..4) under `name` (1..15 characters). */
  uploadProfile(slot: number, name: string, arrays: CloArrays): Promise<void>;
  /** Renames a user IR or profile slot (0..4); what the slot holds is untouched. */
  renameSlot(kind: 'ir' | 'profile', slot: number, name: string): Promise<void>;
  /** Copies stored preset `source` (0..99) over user slot `destination` (0..49), checked by reading both back. */
  copyPreset(destination: number, source: number): Promise<void>;
  /** Turns the tuner on or off; the pedal neither answers nor reports it. */
  setTuner(on: boolean): Promise<void>;
  /** Empties a user IR or profile slot (0..4); resolves once the pedal reports it empty. */
  clearSlot(kind: 'ir' | 'profile', slot: number): Promise<void>;
  /** Device-wide settings (12 10). */
  readGlobals(): Promise<GlobalSettings>;
  /** Sends setting writes (setGlobal / setExpFsTarget bytes) and waits until they are written. */
  writeGlobals(bytes: Uint8Array[]): Promise<void>;
}

/** The TONE3000 API calls the session uses; injectable for tests. */
export interface Tone3000Api {
  startDeviceLogin: typeof startDeviceLogin;
  pollDeviceToken: (o: { clientId: string; start: DeviceLogin }) => Promise<Tokens>;
  searchTones: typeof searchTones;
  listModels: typeof listModels;
  downloadModel: typeof downloadModel;
}

export interface Extras {
  readonly tone3000?: { readonly store: Tone3000Store; readonly api?: Tone3000Api };
  readonly convert?: Converter;
}

const defaultTone3000Api: Tone3000Api = { startDeviceLogin, pollDeviceToken: (o) => pollDeviceToken(o), searchTones, listModels, downloadModel };

export interface Connection {
  readonly io: PedalIO;
  close(): void;
}

export interface Folders {
  readonly backups: string;
  readonly presets: string;
  /** WAV impulse responses that load_ir reads. */
  readonly irs: string;
  /** .nam captures that load_nam reads. */
  readonly nams: string;
}

/**
 * The pedal as the MCP tools see it. Every call opens its own connection and closes it, so an
 * unplugged pedal or the web editor in between never leaves stale state; calls run one at a time.
 */
const UNDO_LIMIT = 20;

export class Session {
  readonly #connect: () => Connection | Promise<Connection>;
  readonly #folders: Folders;
  #queue: Promise<unknown> = Promise.resolve();

  readonly #extras: Extras;
  #login: { readonly text: string; readonly done: Promise<void> } | null = null;
  /** The edit buffer before each edit_preset since the preset was loaded (newest last), for undo. */
  #undo: readonly { readonly index: number; readonly before: Preset }[] = [];

  constructor(connect: () => Connection | Promise<Connection>, folders: Folders, extras: Extras = {}) {
    this.#connect = connect;
    this.#folders = folders;
    this.#extras = extras;
  }

  #use<T>(run: (io: PedalIO) => Promise<T>): Promise<T> {
    const call = this.#queue.then(async () => {
      const connection = await this.#connect();
      try {
        return await run(connection.io);
      } finally {
        connection.close();
      }
    });
    this.#queue = call.catch(() => undefined);
    return call;
  }

  // Names are read on every call: they can change on the pedal or in the web editor between calls.
  #slots(io: PedalIO): Promise<SlotNames> {
    return io.readSlotNames();
  }

  #presetNames(io: PedalIO): Promise<string[]> {
    return io.readNames();
  }

  async #describe(io: PedalIO): Promise<string> {
    const index = await io.readCurrentIndex();
    const preset = decodePreset(await io.readEditBuffer());
    const names = await this.#presetNames(io);
    const slots = await this.#slots(io);
    const modified = await io.readModified();
    return formatPreset(index, names[index] ?? '', preset, slots, modified);
  }

  describe(): Promise<string> {
    return this.#use((io) => this.#describe(io));
  }

  listPresets(): Promise<string> {
    return this.#use(async (io) => {
      const names = await this.#presetNames(io);
      return names.map((name, i) => `${presetLabel(i)} ${name}`).join('\n');
    });
  }

  /** Models of one block, or of every block: what each is based on, what it does, its parameters. */
  listModels(block?: string): Promise<string> {
    return this.#use(async (io) => {
      const preset = decodePreset(await io.readEditBuffer());
      const slots = await this.#slots(io);
      const blocks = block === undefined ? preset.chain : [resolveBlock(preset, block)];
      return blocks.map((b) => formatModels(b.key, b.label, slots)).join('\n\n');
    });
  }

  /** Checks every change against the preset before anything is sent, then sends them in order. */
  edit(changes: readonly Change[]): Promise<string> {
    return this.#use(async (io) => {
      const slots = await this.#slots(io);
      let preset = decodePreset(await io.readEditBuffer());
      const before = { index: await io.readCurrentIndex(), before: preset };
      const commands: Uint8Array[] = [];
      for (const change of changes) {
        const edit = toEdit(preset, change, slots);
        commands.push(...editToCommands(preset, edit));
        preset = applyEdit(preset, edit);
      }
      await io.sendEdits(commands);
      this.#undo = [...this.#undo, before].slice(-UNDO_LIMIT);
      return this.#describe(io);
    });
  }

  /** Puts the edit buffer back as it was before the last edit, checked; refuses on another preset. */
  undo(): Promise<string> {
    return this.#use(async (io) => {
      const last = this.#undo.at(-1);
      if (!last) throw new Error('Nothing to undo: no edit_preset since the preset was loaded.');
      const index = await io.readCurrentIndex();
      if (index !== last.index) {
        this.#undo = [];
        throw new Error(`Nothing to undo here: the edits were on ${presetLabel(last.index)}, and ${presetLabel(index)} is loaded now.`);
      }
      await applyPreset(io, last.before);
      this.#undo = this.#undo.slice(0, -1);
      return `Undid the last edit (${this.#undo.length} more can be undone).\n\n${await this.#describe(io)}`;
    });
  }

  async select(label: string): Promise<string> {
    const index = parsePresetLabel(label);
    return this.#use(async (io) => {
      this.#undo = [];
      await io.selectPreset(index);
      return this.#describe(io);
    });
  }

  /** Reloads the loaded preset from its slot, discarding unsaved edits. */
  revert(): Promise<string> {
    return this.#use(async (io) => {
      this.#undo = [];
      await io.selectPreset(await io.readCurrentIndex());
      return this.#describe(io);
    });
  }

  async save(options: { slot: string; name: string; confirm: string; backup?: boolean }): Promise<string> {
    const target = parsePresetLabel(options.slot);
    const label = presetLabel(target);
    requireConfirm(options.confirm, label);
    return this.#use(async (io) => {
      const { paths } = await this.#keepingBackups((onBackup) =>
        saveToSlot(io, { target, name: options.name, backup: options.backup !== false, edited: null, onBackup }));
      const note = paths.map((path) => `\nBackup of the old ${label}: ${path}`).join('');
      return `Saved ${label} "${options.name}".${note}\n\n${await this.#describe(io)}`;
    });
  }

  async restore(options: { file: string; slot?: string; confirm: string }): Promise<string> {
    const backup = parseBackupFile(await readFile(inside(this.#folders.backups, options.file), 'utf8'));
    const wanted = options.slot === undefined ? null : parsePresetLabel(options.slot);
    const slots = backup.slots.filter((s) => wanted === null || s.index === wanted);
    if (slots.length !== 1) {
      throw new Error(`the backup holds ${backup.slots.map((s) => s.label).join(', ')}; name the one to restore with slot`);
    }
    const slot = slots[0]!;
    requireConfirm(options.confirm, slot.label);
    return this.#use(async (io) => {
      const { paths } = await this.#keepingBackups((onBackup) => restoreFromBackup(io, slot, { onBackup, backup: true }));
      const note = paths.map((path) => `\nBackup of what it replaced: ${path}`).join('');
      return `Restored ${slot.label} "${slot.name}".${note}\n\n${await this.#describe(io)}`;
    });
  }

  /** Copies a stored preset over a user slot, after backing that slot up; the loaded preset is untouched. */
  async copy(options: { source: string; destination: string; confirm: string }): Promise<string> {
    const source = parsePresetLabel(options.source);
    const destination = parsePresetLabel(options.destination);
    const label = presetLabel(destination);
    if (destination >= USER_PRESETS) throw new Error('the destination must be a user slot, P01..P50');
    if (destination === source) throw new Error(`${label} cannot be copied onto itself`);
    requireConfirm(options.confirm, label);
    return this.#use(async (io) => {
      const { paths } = await this.#keepingBackups(async (onBackup) => {
        await onBackup(await backupStoredSlot(io, destination));
        await io.copyPreset(destination, source);
      });
      const names = await this.#presetNames(io);
      const note = paths.map((path) => `\nBackup of the old ${label}: ${path}`).join('');
      return `Copied ${presetLabel(source)} "${names[source] ?? ''}" to ${label}.${note}\n\n${await this.#describe(io)}`;
    });
  }

  tuner(options: { on: boolean }): Promise<string> {
    return this.#use(async (io) => {
      await io.setTuner(options.on);
      return `Tuner ${options.on ? 'on' : 'off'}. The pedal does not report the tuner state, so this is only what was sent.`;
    });
  }

  /** Empties user IR or captured-profile slot 1..5; confirm must be the name it holds. */
  async deleteSlot(options: { kind: 'ir' | 'profile'; slot: number; confirm: string }): Promise<string> {
    const { kind, slot } = options;
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot must be 1..5');
    const what = kind === 'ir' ? 'user IR' : 'profile';
    return this.#use(async (io) => {
      const name = (await this.#slots(io))[kind === 'ir' ? 'irNames' : 'profileNames']?.[slot - 1] ?? null;
      if (name === null) throw new Error(`${kind === 'ir' ? 'User IR' : 'Profile'} slot ${slot} is already empty`);
      if (options.confirm.trim().toUpperCase() !== name.toUpperCase()) throw new Error(`confirm must be "${name}" to delete that slot`);
      await io.clearSlot(kind, slot - 1);
      return `Deleted ${what} slot ${slot} "${name}". It is empty now; presets that used it keep their settings.`;
    });
  }

  /** Backs up P01..P50 to one file, read without loading them. */
  backupAll(): Promise<string> {
    return this.#use(async (io) => {
      const file = await backupAllSlots(io, { edited: null });
      return `Backed up P01..P50 to ${await this.#writeBackup(file)}.`;
    });
  }

  /** Collects the path of every backup the flow stores; the flow waits for each before writing the slot. */
  async #keepingBackups(run: (onBackup: (file: BackupFile) => Promise<void>) => Promise<unknown>): Promise<{ paths: string[] }> {
    const paths: string[] = [];
    try {
      await run(async (file) => void paths.push(await this.#writeBackup(file)));
    } catch (error) {
      if (paths.length === 0) throw error;
      throw new Error(`${error instanceof Error ? error.message : String(error)} (backup kept: ${paths.join(', ')})`, { cause: error });
    }
    return { paths };
  }

  async #writeBackup(file: BackupFile): Promise<string> {
    const slots = file.slots.map((s) => s.label).join('-');
    const base = join(this.#folders.backups, `${file.createdAt.replace(/[:.]/g, '-')}-${slots}`);
    await mkdir(this.#folders.backups, { recursive: true });
    for (let n = 1; ; n++) {
      const path = n === 1 ? `${base}.json` : `${base}-${n}.json`;
      try {
        await writeFile(path, JSON.stringify(file, null, 2), { flag: 'wx' }); // never replaces an older backup
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 100) throw error;
      }
    }
  }

  exportPreset(file?: string, notes?: string): Promise<string> {
    return this.#use(async (io) => {
      const index = await io.readCurrentIndex();
      const name = (await this.#presetNames(io))[index] ?? '';
      const payload = await io.readEditBuffer();
      const path = file ? inside(this.#folders.presets, file) : join(this.#folders.presets, `${presetLabel(index)}-${safe(name)}-${Date.now()}.json`);
      await mkdir(resolve(path, '..'), { recursive: true });
      try {
        await writeFile(path, JSON.stringify(presetFile(payload, name, undefined, notes), null, 2), { flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${path} already exists; choose another file name`);
        throw error;
      }
      return `Exported ${presetLabel(index)} "${name}" to ${path}`;
    });
  }

  /** The preset files in the presets folder, with their notes: the library of approved tones. */
  async listPresetFiles(): Promise<string> {
    const folder = this.#folders.presets;
    const names = (await readdir(folder, { recursive: true }).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).sort();
    const lines = await Promise.all(names.map(async (file) => {
      try {
        const preset = parsePresetFile(await readFile(join(folder, file), 'utf8'));
        return `- ${file}: "${preset.name}"${preset.notes ? ` — ${preset.notes}` : ''} (${preset.createdAt.slice(0, 10)})`;
      } catch {
        return `- ${file}: not a readable preset file`;
      }
    }));
    return lines.length > 0 ? `Preset files in ${folder}:\n${lines.join('\n')}` : `No preset files yet in ${folder}.`;
  }

  /**
   * Loads a WAV from the irs folder into user IR `slot` (1..5). The pedal cannot send an IR back,
   * so a slot that already holds one is only overwritten with `replace`.
   */
  async loadIr(options: { file: string; slot: number; confirm: string; name?: string; replace?: boolean }): Promise<string> {
    const { slot } = options;
    if (!Number.isInteger(slot) || slot < 1 || slot > IR_SLOTS) throw new Error(`slot must be 1..${IR_SLOTS}`);
    requireConfirm(options.confirm, `IR${slot}`);
    const path = inside(this.#folders.irs, options.file);
    const wav = new Uint8Array(await readFile(path));
    return this.#installIr(wav, { ...options, name: options.name ?? defaultName(options.file, 10, 'User IR') });
  }

  async #installIr(wav: Uint8Array, options: { slot: number; confirm: string; name: string; replace?: boolean }): Promise<string> {
    const { slot } = options;
    if (!Number.isInteger(slot) || slot < 1 || slot > IR_SLOTS) throw new Error(`slot must be 1..${IR_SLOTS}`);
    requireConfirm(options.confirm, `IR${slot}`);
    const name = options.name.trim();
    irUploadBlob(slot - 1, name, irSamplesFromWav(wav)); // checks the WAV and the name before connecting
    return this.#use(async (io) => {
      const current = (await this.#slots(io)).irNames?.[slot - 1] ?? null;
      if (current !== null && !options.replace) {
        throw new Error(`User IR ${slot} holds "${current}", which cannot be backed up from the pedal; keep its WAV, then pass replace: true to overwrite it`);
      }
      await io.uploadIr(slot - 1, name, wav);
      const names = (await this.#slots(io)).irNames ?? [];
      const list = names.map((n, i) => `User IR ${i + 1}: ${n ?? '(empty)'}`).join('\n');
      return `Loaded "${name}" into User IR ${slot}${current ? ` (replacing "${current}")` : ''}. Pick it in the IR block with edit_preset.\n\n${list}`;
    });
  }

  /** Signs in to TONE3000 with a code the user approves at tone3000.com; waits in the background. */
  async tone3000Login(): Promise<string> {
    const { store, api } = this.#tone3000();
    if (await store.accessToken()) return 'Signed in to TONE3000 already. Use search_tone3000.';
    if (this.#login) return this.#login.text;
    const clientId = await store.clientId();
    const start = await api.startDeviceLogin(clientId);
    const text = `Open ${start.verificationUriComplete} (or ${start.verificationUri} and enter the code ${start.userCode}) to sign in to TONE3000; the code works for ${Math.round(start.expiresIn / 60)} minutes. Then use search_tone3000.`;
    const done = api.pollDeviceToken({ clientId, start })
      .then((tokens) => store.save(tokens))
      .catch((error) => console.error('[pocket-master-mcp] TONE3000 sign-in:', error))
      .finally(() => { this.#login = null; });
    this.#login = { text, done };
    return text;
  }

  /** Searches TONE3000 for captures (format nam) or cabinet IRs (format ir). */
  async searchTone3000(options: { query: string; format?: 'nam' | 'ir'; page?: number }): Promise<string> {
    const { api } = this.#tone3000();
    const token = await this.#tone3000Token();
    const format = options.format ?? 'nam';
    const result = await api.searchTones(token, { query: options.query, format, page: options.page ?? 1 });
    if (result.tones.length === 0) return `TONE3000 has no ${format} results for "${options.query}".`;
    const lines = result.tones.map((t) => {
      const makes = t.makes.length ? ` · ${t.makes.join(', ')}` : '';
      return `- tone ${t.id}: "${t.title}" by ${t.creator} · ${t.gear || 'gear?'}${makes} · ${t.modelsCount} model(s) · ${t.downloads} downloads · ${t.url}${t.description ? `\n    ${t.description.slice(0, 160).replace(/\s+/g, ' ')}` : ''}`;
    });
    return `TONE3000 results for "${options.query}" (${format}), page ${result.page} of ${Math.max(result.totalPages, 1)}:\n${lines.join('\n')}`;
  }

  /**
   * Downloads a TONE3000 model and puts it on the pedal: a NAM capture is converted and written
   * to a profile slot, a cabinet IR (WAV) to a user IR slot.
   */
  async installTone(options: { toneId: number; modelId?: number; slot: number; confirm: string; replace?: boolean; name?: string }): Promise<string> {
    const { api } = this.#tone3000();
    const token = await this.#tone3000Token();
    const models = await api.listModels(token, options.toneId);
    const model = options.modelId !== undefined ? models.find((m) => m.id === options.modelId) : models.length === 1 ? models[0] : undefined;
    if (!model) {
      const list = models.map((m) => `- model ${m.id}: ${m.name}${m.size ? ` (${m.size})` : ''}`).join('\n');
      throw new Error(models.length === 0 ? `tone ${options.toneId} has no models` : `tone ${options.toneId} has several models; pass modelId:\n${list}`);
    }
    const bytes = await api.downloadModel(token, model.url);
    const name = options.name ?? model.name;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return this.#installIr(bytes, { ...options, name: defaultName(name, 10, 'TONE3000') });
    }
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith('{')) throw new Error('the downloaded model is neither a NAM capture nor a WAV IR');
    return this.#installNam(text, { ...options, name: defaultName(name, PROFILE_NAME, 'TONE3000') });
  }

  /** Converts a .nam from the nams folder and writes it to a profile slot. */
  async loadNam(options: { file: string; slot: number; confirm: string; replace?: boolean; name?: string }): Promise<string> {
    const json = await readFile(inside(this.#folders.nams, options.file), 'utf8');
    return this.#installNam(json, { ...options, name: options.name ?? defaultName(options.file, PROFILE_NAME, 'NAM capture') });
  }

  async #installNam(namJson: string, options: { slot: number; confirm: string; name: string; replace?: boolean }): Promise<string> {
    const { slot } = options;
    if (!Number.isInteger(slot) || slot < 1 || slot > PROFILE_SLOTS) throw new Error(`profile slot must be 1..${PROFILE_SLOTS}`);
    requireConfirm(options.confirm, `PROFILE${slot}`);
    const name = options.name.trim();
    const convert = this.#extras.convert;
    if (!convert) throw new Error('NAM conversion is not available in this server');
    parseNam(namJson); // refuses unsupported captures before anything else
    const empty = { arrayA: new Float32Array(128), arrayB: new Float32Array(2048), gains: [1, 1, 1, 1] as const };
    profileUploadBlob(slot - 1, name, empty); // checks slot and name
    // The conversion takes minutes; check the slot first so it is not wasted on a refusal.
    const current = await this.#use(async (io) => (await this.#slots(io)).profileNames?.[slot - 1] ?? null);
    if (current !== null && !options.replace) {
      throw new Error(`profile slot ${slot} holds "${current}", which cannot be backed up from the pedal; keep its .nam, then pass replace: true to overwrite it`);
    }
    const started = Date.now();
    const arrays = await convert(namJson);
    const seconds = Math.round((Date.now() - started) / 1000);
    return this.#use(async (io) => {
      await io.uploadProfile(slot - 1, name, arrays);
      return `Converted in ${seconds} s and loaded "${name}" into profile slot ${slot}${current ? ` (replacing "${current}")` : ''}. Use it with edit_preset: AMP model "${name}" (clone mode).\n\n${await this.#describe(io)}`;
    });
  }

  #tone3000(): { store: Tone3000Store; api: Tone3000Api } {
    const t = this.#extras.tone3000;
    if (!t) throw new Error('TONE3000 is not set up in this server');
    return { store: t.store, api: t.api ?? defaultTone3000Api };
  }

  async #tone3000Token(): Promise<string> {
    const token = await this.#tone3000().store.accessToken();
    if (!token) throw new Error(this.#login ? 'the TONE3000 sign-in is not approved yet; open the link from tone3000_login first' : 'not signed in to TONE3000; call tone3000_login first');
    return token;
  }

  /** Renames user IR (1..10 characters) or captured-profile (1..15) slot 1..5. */
  async renameSlot(options: { kind: 'ir' | 'profile'; slot: number; name: string }): Promise<string> {
    const { kind, slot } = options;
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot must be 1..5');
    const name = options.name.trim();
    if (kind === 'ir') irUploadBlob(slot - 1, name, new Int32Array(512)); // checks the name
    else profileUploadBlob(slot - 1, name, { arrayA: new Float32Array(128), arrayB: new Float32Array(2048), gains: [1, 1, 1, 1] });
    return this.#use(async (io) => {
      const before = (await this.#slots(io))[kind === 'ir' ? 'irNames' : 'profileNames']?.[slot - 1] ?? null;
      if (before === null) throw new Error(`${kind === 'ir' ? 'User IR' : 'Profile'} slot ${slot} is empty; nothing to rename`);
      await io.renameSlot(kind, slot - 1, name);
      return `Renamed ${kind === 'ir' ? 'user IR' : 'profile'} slot ${slot} from "${before}" to "${name}".`;
    });
  }

  getGlobals(): Promise<string> {
    return this.#use(async (io) => describeGlobals(await io.readGlobals()));
  }

  /** Changes device-wide settings; every value is checked before anything is sent. Never a factory reset. */
  async setGlobals(changes: GlobalChanges): Promise<string> {
    const { bytes, summary } = globalWrites(changes);
    return this.#use(async (io) => {
      await io.writeGlobals(bytes);
      return `Set ${summary.join(', ')}. These are device-wide settings, stored by the pedal at once (no preset save needed).`;
    });
  }

  importPreset(file: string): Promise<string> {
    return this.#use(async (io) => {
      const preset = parsePresetFile(await readFile(inside(this.#folders.presets, file), 'utf8'));
      await loadIntoEditBuffer(io, decodePreset(fromHex(preset.payload)));
      this.#undo = [];
      return `Loaded "${preset.name}" into the edit buffer (not saved).\n\n${await this.#describe(io)}`;
    });
  }
}

function requireConfirm(confirm: string, label: string): void {
  if (confirm.trim().toUpperCase() !== label) throw new Error(`confirm must be "${label}" to write that slot`);
}

/** `file` resolved against `folder`; refused when it would land outside it. */
function inside(folder: string, file: string): string {
  const path = resolve(folder, file);
  const rel = relative(folder, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`the file must be inside ${folder}`);
  return path;
}

/** A file or tone name as printable ASCII, without folder and extension, at most `max` characters. */
function defaultName(file: string, max: number, fallback: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const stem = base.replace(/\.(wav|nam|json)$/i, '');
  return stem.replace(/[^\x20-\x7e]/g, '_').slice(0, max).trim() || fallback;
}

const PROFILE_SLOTS = 5;
const PROFILE_NAME = 15;

const safe = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'preset';

