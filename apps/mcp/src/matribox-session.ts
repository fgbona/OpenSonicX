/**
 * The Matribox II Pro as the MCP tools see it. Like the Pocket Master session, every call opens its
 * own connection and closes it, and calls run one at a time. The model catalog comes from the user's
 * install of Sonicake's official editor; it is loaded once, when first needed. Writes (experimental,
 * validated on one unit only so far) change the loaded preset; only savePreset stores it, after a
 * backup of the slot it overwrites.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkMbPresetName, mbPresetLabel, mbReadCloneNames, mbReadCurrentPresetNumber, mbReadIrNames, mbReadPreset, mbReadPresetNames,
  MB_SLOTS, mbAddBlock, mbBackupAllPresets, mbChangeModel, mbMoveBlock, mbReadLoadedIndex, mbReadSlot, mbRemoveBlock, mbRestoreAllPresets, mbSavePreset, mbSelectPreset,
  mbSetBlockOn, mbSetParam, mbStoreSlot, parseMbPresetLabel, toHex,
  parseMbCloneNames, parseMbCurrentPresetNumber, parseMbIrNames, parseMbPreset, parseMbPresetNames, resolveMbPreset,
  type MbCatalog, type MbModel, type MbModule, type MbPreset, type MbResolvedBlock, type MbResolvedPreset,
} from '@pocket-master/core';
import { assignExpression, assignFootswitch, CC_NOTE, describeAssignments, setExpressionRange, setVolume } from './matribox-live.ts';
import {
  MATRIBOX_DEVICE, readMatriboxBackup, readMatriboxBackupAll, readMatriboxPrst, writeMatriboxBackupAll, writeMatriboxPrstFile,
} from './matribox-files.ts';
import { prepareMatriboxIr, uploadMatriboxIr, type MatriboxIrOptions } from './matribox-ir.ts';
import type { MatriboxConnection } from './matribox-link.ts';
import {
  checkParam, describeValues, EXPERIMENTAL, findBlock, findModel, findModule, gear, knownModel, modelTitle, modelValues, planTone, type ParamWrite, type ToneBlock,
} from './matribox-edit.ts';

/** Reads of the slot after a save before giving up, and the pause between them. */
const SAVE_CHECKS = 3;
const SAVE_CHECK_MS = 300;
const round = (n: number) => String(Number(n.toFixed(2)));
const experimental = (lines: readonly string[]) => [...lines, EXPERIMENTAL].join('\n');
/** The whole-preset write (import, restore) is decoded from a capture but not yet sent to a unit by us. */
export const UNCHECKED = 'Experimental: the whole-preset write is decoded from the official editor\'s traffic and not yet checked on the owner\'s unit. Check the result with matribox_get_preset and by ear.';
const sectionHex = (preset: MbPreset, id: number) => toHex(preset.sections.find((s) => s.id === id)?.body ?? new Uint8Array());
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
type Target = { index: number; label: string; name: string };
const firstSentence = (text: string) => /^.*?[.!?](\s|$)/s.exec(text.trim())?.[0].trim() ?? text.trim();

/** IR and CLONE models stand for a user slot: its number is the fxid's low byte. */
function slotName(block: MbResolvedBlock, irNames: readonly string[], cloneNames: readonly string[]): string | undefined {
  const names = block.module === 'IR' ? irNames : block.module === 'CLONE' ? cloneNames : null;
  return names?.[block.fxid & 0xff]?.trim();
}

function formatBlock(block: MbResolvedBlock, irNames: readonly string[], cloneNames: readonly string[]): string {
  const head = `${block.position}. ${block.module}  ${block.on ? 'on ' : 'off'}`;
  if (!block.model) return `${head}  unknown model (fxid 0x${block.fxid.toString(16).padStart(8, '0')})`;
  const user = slotName(block, irNames, cloneNames);
  const model = `${block.model.name}${user ? ` "${user}"` : ''}${gear(block.model) ? ` (based on ${gear(block.model)})` : ''}`;
  const params = block.params.map((p) => `${p.name} ${round(p.value)} [${round(p.min)}..${round(p.max)}]`).join(', ');
  return `${head}  ${model}${params ? `: ${params}` : ''}`;
}

function formatModel(model: MbModel): string {
  const about = [gear(model) ? `based on ${gear(model)}.` : '', firstSentence(model.description)].filter(Boolean).join(' ');
  const params = model.params.map((p) => `${p.name} ${round(p.min)}..${round(p.max)}`).join(', ');
  return `- ${model.name}${about ? `: ${about}` : ''}${params ? `\n    params: ${params}` : ''}`;
}

const formatModule = (module: MbModule) => `${module.name} models:\n${module.models.map(formatModel).join('\n')}`;

export interface MatriboxFolders {
  /** Where savePreset keeps the overwritten slots, and restoreBackup reads them. */
  readonly backups: string;
  /** The Matribox's .prst files (export, import). */
  readonly presets: string;
  /** WAV impulse responses that loadIr reads (shared with the Pocket Master). */
  readonly irs: string;
}

/** The slot label `preset`, checked against `confirm`, and the preset name, before anything is sent. */
function checkSave(preset: string, confirm: string | undefined, name: string): Target {
  const index = parseMbPresetLabel(preset);
  const label = mbPresetLabel(index);
  if (confirm?.trim().toUpperCase() !== label) throw new Error(`confirm must be "${label}" to write that slot`);
  return { index, label, name: checkMbPresetName(name) };
}

export class MatriboxSession {
  readonly #connect: () => MatriboxConnection | Promise<MatriboxConnection>;
  readonly #loadCatalog: () => Promise<MbCatalog>;
  readonly #folders: MatriboxFolders;
  #catalog: Promise<MbCatalog> | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(connect: () => MatriboxConnection | Promise<MatriboxConnection>, loadCatalog: () => Promise<MbCatalog>, folders: MatriboxFolders) {
    this.#connect = connect;
    this.#loadCatalog = loadCatalog;
    this.#folders = folders;
  }

  #use<T>(run: (unit: MatriboxConnection) => Promise<T>): Promise<T> {
    const call = this.#queue.then(async () => {
      const connection = await this.#connect();
      try {
        return await run(connection);
      } finally {
        connection.close();
      }
    });
    this.#queue = call.catch(() => undefined);
    return call;
  }

  /** Loaded once; a failure is not kept, so installing the app later works without a restart. */
  #catalogOnce(): Promise<MbCatalog> {
    this.#catalog ??= this.#loadCatalog().catch((error: unknown) => {
      this.#catalog = null;
      throw error;
    });
    return this.#catalog;
  }

  listPresets(): Promise<string> {
    return this.#use(async (unit) => {
      const presets = parseMbPresetNames(await unit.read(mbReadPresetNames()));
      const current = parseMbCurrentPresetNumber(await unit.read(mbReadCurrentPresetNumber()));
      const lines = presets.map((p, i) => `${i === current ? '*' : ' '} ${mbPresetLabel(i).padEnd(3)} ${p.name}${p.style ? ` (${p.style})` : ''}`);
      return [`Loaded: ${mbPresetLabel(current)} "${presets[current]?.name ?? ''}"`, ...lines].join('\n');
    });
  }

  /** The loaded preset: chain in signal order, each block's model, what it is based on, on/off and parameters. */
  describe(): Promise<string> {
    return this.#use(async (unit) => {
      const catalog = await this.#catalogOnce();
      const current = parseMbCurrentPresetNumber(await unit.read(mbReadCurrentPresetNumber()));
      const preset = resolveMbPreset(parseMbPreset(await unit.read(mbReadPreset(current))), catalog);
      const irNames = parseMbIrNames(await unit.read(mbReadIrNames()));
      const cloneNames = parseMbCloneNames(await unit.read(mbReadCloneNames()));
      const head = `${mbPresetLabel(current)} "${preset.name}"${preset.style ? ` · style ${preset.style}` : ''}`;
      return [
        head,
        `Chain: ${preset.chain.map((b) => b.module).join(' → ')}`,
        ...preset.chain.map((b) => formatBlock(b, irNames, cloneNames)),
      ].join('\n');
    });
  }

  /** The catalog (no pedal needed): every module's models, or one module's. */
  async listModels(module?: string): Promise<string> {
    const catalog = await this.#catalogOnce();
    if (module === undefined) return catalog.modules.map(formatModule).join('\n\n');
    const found = catalog.modules.find((m) => m.name.toLowerCase() === module.trim().toLowerCase());
    if (!found) throw new Error(`No module "${module}". Modules: ${catalog.modules.map((m) => m.name).join(', ')}`);
    return formatModule(found);
  }

  listIrs(): Promise<string> {
    return this.#use(async (unit) => parseMbIrNames(await unit.read(mbReadIrNames())).map((name, i) => `User IR ${i + 1}: ${name.trim()}`).join('\n'));
  }

  /** Loads a WAV from the irs folder into user IR `slot` (1..20); see matribox-ir.ts. */
  async loadIr(options: MatriboxIrOptions): Promise<string> {
    const prepared = await prepareMatriboxIr(this.#folders.irs, options); // checked before the unit is opened
    return this.#use((unit) => uploadMatriboxIr(unit, options.slot, prepared, options.replace));
  }

  listCaptures(): Promise<string> {
    return this.#use(async (unit) => parseMbCloneNames(await unit.read(mbReadCloneNames())).map((name, i) => `Capture ${i + 1}: ${name.trim()}`).join('\n'));
  }

  /** The loaded preset, raw and named from the catalog. */
  async #loaded(unit: MatriboxConnection): Promise<{ catalog: MbCatalog; raw: MbPreset; preset: MbResolvedPreset }> {
    const catalog = await this.#catalogOnce();
    const raw = await MatriboxSession.#loadedRaw(unit);
    return { catalog, raw, preset: resolveMbPreset(raw, catalog) };
  }

  /** The loaded preset as the unit holds it (edits included), no catalog needed. */
  static async #loadedRaw(unit: MatriboxConnection): Promise<MbPreset> {
    const current = parseMbCurrentPresetNumber(await unit.read(mbReadCurrentPresetNumber()));
    return parseMbPreset(await unit.read(mbReadPreset(current)));
  }

  static async #writeAll(unit: MatriboxConnection, frames: readonly Uint8Array[]): Promise<void> {
    for (const frame of frames) await unit.write(frame); // one at a time: each waits for its echo
  }

  static #paramFrames(params: readonly ParamWrite[]): Uint8Array[] {
    return params.map((p) => mbSetParam(p.slot, p.id, p.value));
  }

  /** One parameter of a block of the loaded preset, by name, within the catalog's range. */
  setParam(options: { block: string; parameter: string; value: number }): Promise<string> {
    return this.#use(async (unit) => {
      const { preset } = await this.#loaded(unit);
      const block = findBlock(preset, options.block);
      const model = knownModel(block);
      const param = checkParam(model, options.parameter, options.value);
      await unit.write(mbSetParam(block.slot, param.id, options.value));
      const before = block.params.find((p) => p.id === param.id)?.value;
      return experimental([`${block.module} ${model.name}: ${param.name} ${before === undefined ? '' : `${round(before)} → `}${round(options.value)}`]);
    });
  }

  setBlockOn(options: { block: string; on: boolean }): Promise<string> {
    return this.#use(async (unit) => {
      const block = findBlock((await this.#loaded(unit)).preset, options.block);
      await unit.write(mbSetBlockOn(block.slot, options.on));
      return experimental([`${block.module} ${block.model?.name ?? 'unknown model'}: ${options.on ? 'on' : 'off'}`]);
    });
  }

  /** Loads a preset by label (1A..60D); unsaved edits of the loaded one are lost. */
  selectPreset(options: { preset: string }): Promise<string> {
    const index = parseMbPresetLabel(options.preset);
    return this.#use(async (unit) => {
      await unit.write(mbSelectPreset(index));
      return experimental([`Loaded ${mbPresetLabel(index)}.`]);
    });
  }

  /** Swaps the model in one block (any module's model); the unit loads the new model's defaults. */
  setModel(options: { block: string; model: string }): Promise<string> {
    return this.#use(async (unit) => {
      const { catalog, preset } = await this.#loaded(unit);
      const block = findBlock(preset, options.block);
      const { module, model } = findModel(catalog, options.model);
      await unit.write(mbChangeModel(block.slot, module.index, model.fxid));
      const now = findBlock((await this.#loaded(unit)).preset, String(block.position));
      const values = now.params.map((p) => `${p.name} ${round(p.value)}`).join(', ');
      return experimental([`${module.name}: ${block.model?.name ?? 'unknown model'} → ${modelTitle(model)}${values ? `: ${values}` : ''}`]);
    });
  }

  /** Inserts a block at 1-based `position` (default: the end), then writes its parameters by the slot the unit picked. */
  addBlock(options: ToneBlock & { position?: number }): Promise<string> {
    return this.#catalogOnce().then((catalog) => {
      const { module, model } = findModel(catalog, options.model, findModule(catalog, options.module));
      const values = modelValues(model, 0, options.params); // checked before the unit is opened
      return this.#use(async (unit) => {
        const count = (await this.#loaded(unit)).preset.chain.length;
        if (count >= MB_SLOTS) throw new Error(`The chain is full (${MB_SLOTS} blocks): remove one first.`);
        const position = options.position ?? count + 1;
        if (!Number.isInteger(position) || position < 1 || position > count + 1) throw new Error(`position must be 1..${count + 1}, got ${position}`);
        await unit.write(mbAddBlock(position - 1, module.index, model.fxid));
        const slot = (await this.#loaded(unit)).preset.chain[position - 1]?.slot;
        if (slot === undefined) throw new Error(`Matribox II PRO did not add the block at ${position}`);
        const on = options.on ?? true;
        await MatriboxSession.#writeAll(unit, [...MatriboxSession.#paramFrames(modelValues(model, slot, options.params)), ...(on ? [] : [mbSetBlockOn(slot, false)])]);
        return experimental([`Added ${module.name} ${modelTitle(model)} at ${position}${on ? '' : ' (off)'}${values.length ? `: ${describeValues(model, values)}` : ''}`]);
      });
    });
  }

  removeBlock(options: { block: string }): Promise<string> {
    return this.#use(async (unit) => {
      const block = findBlock((await this.#loaded(unit)).preset, options.block);
      await unit.write(mbRemoveBlock(block.position - 1));
      return experimental([`Removed ${block.module} ${block.model?.name ?? 'unknown model'} from ${block.position}.`]);
    });
  }

  /** Moves a block to 1-based position `to` in the chain. */
  moveBlock(options: { block: string; to: number }): Promise<string> {
    return this.#use(async (unit) => {
      const { preset } = await this.#loaded(unit);
      const block = findBlock(preset, options.block);
      const count = preset.chain.length;
      if (!Number.isInteger(options.to) || options.to < 1 || options.to > count) throw new Error(`to must be 1..${count}, got ${options.to}`);
      const what = `${block.module} ${block.model?.name ?? 'unknown model'}`;
      if (options.to === block.position) return experimental([`${what} is already at ${block.position}.`]);
      await unit.write(mbMoveBlock(block.position - 1, options.to - 1));
      return experimental([`Moved ${what} from ${block.position} to ${options.to}.`]);
    });
  }

  /**
   * Replaces the loaded preset's chain with `blocks` in signal order: removes every block, adds the
   * new ones (the unit picks their slots), then writes every parameter and on/off by slot.
   */
  buildTone(options: { blocks: readonly ToneBlock[] }): Promise<string> {
    return this.#catalogOnce().then((catalog) => {
      const plan = planTone(catalog, options.blocks); // everything checked before the unit is opened
      return this.#use(async (unit) => {
        const old = (await this.#loaded(unit)).preset.chain;
        for (let i = old.length - 1; i >= 0; i--) await unit.write(mbRemoveBlock(i)); // from the end: positions stay put
        for (const [i, b] of plan.blocks.entries()) await unit.write(mbAddBlock(i, b.moduleIndex, b.fxid));
        const added = (await this.#loaded(unit)).preset.chain;
        for (const [i, b] of plan.blocks.entries()) {
          const slot = added[i]?.slot;
          if (slot === undefined) throw new Error(`Matribox II PRO did not add block ${i + 1}: its chain now has ${added.length} blocks`);
          await MatriboxSession.#writeAll(unit, [...MatriboxSession.#paramFrames(modelValues(b.model, slot, b.params)), mbSetBlockOn(slot, b.on)]);
        }
        return experimental([...plan.lines, 'Nothing is stored until matribox_save_preset.']);
      });
    });
  }

  /** Patch volume, footswitch and expression assignments, and assignments read (matribox-live.ts). */
  getAssignments(): Promise<string> {
    return this.#use(async (unit) => {
      const { raw, preset } = await this.#loaded(unit);
      return describeAssignments(raw.number ?? 0, preset, raw);
    });
  }

  setVolume(options: { volume: number }): Promise<string> {
    return this.#use((unit) => setVolume(unit, options.volume));
  }

  assignFootswitch(options: { footswitch: string; block: string; assign: boolean }): Promise<string> {
    return this.#use(async (unit) => assignFootswitch(unit, (await this.#loaded(unit)).preset, options));
  }

  assignExpression(options: { entry: number; block: string; parameter: string; min?: number; max?: number }): Promise<string> {
    return this.#use(async (unit) => assignExpression(unit, (await this.#loaded(unit)).preset, options));
  }

  setExpressionRange(options: { entry: number; min?: number; max?: number }): Promise<string> {
    return this.#use((unit) => setExpressionRange(unit, options));
  }

  /** MIDI Control Changes (built and checked by the caller before the unit is opened); no answer comes. */
  control(messages: readonly Uint8Array[], what: string): Promise<string> {
    return this.#use(async (unit) => {
      messages.forEach((m) => unit.control(m));
      const sent = messages.map((m) => `CC ${m[1]} = ${m[2]}`).join(', ');
      return `${what} (${sent}, MIDI channel ${((messages[0]?.[0] ?? 0xb0) & 0x0f) + 1}).\n${CC_NOTE}`;
    });
  }

  /** Stores the loaded preset (unsaved edits included) in slot `preset` under `name`, after a backup of what the slot holds. */
  savePreset(options: { preset: string; name: string; confirm: string }): Promise<string> {
    const target = checkSave(options.preset, options.confirm, options.name);
    return this.#use(async (unit) => experimental(await this.#save(unit, target)));
  }

  /**
   * A preset read returns the edit buffer whatever slot it names (the unit's bug), so what another
   * slot stores is read only once it is loaded, which drops the edits. Over the loaded slot: back up
   * the edit buffer and save (cmd 05). Over another slot: keep the edit buffer, load the slot, back
   * it up, write the edit buffer into it whole, then save only to rename; that slot stays loaded.
   */
  async #save(unit: MatriboxConnection, target: Target): Promise<string[]> {
    const current = await mbReadLoadedIndex(unit);
    const loaded = await unit.read(mbReadPreset(current));
    const { index, label, name } = target;
    if (index !== current) return this.#saveElsewhere(unit, target, current, loaded);
    const backup = await this.#writeBackup(label, index, loaded, 'edit-buffer');
    await MatriboxSession.#saveLoaded(unit, index, name, parseMbPreset(loaded)).catch((error: unknown) => {
      throw new Error(`${reason(error)} (backup kept: ${backup})`, { cause: error });
    });
    return [`Saved the loaded preset to ${label} "${name}".`, `Backup of ${label} as loaded before the save (the unit only shows what a slot stores once loaded, which would drop the edits): ${backup}`];
  }

  async #saveElsewhere(unit: MatriboxConnection, target: Target, current: number, loaded: Uint8Array): Promise<string[]> {
    const preset = parseMbPreset(loaded);
    try {
      const backup = await this.#storeWhole(unit, target, preset);
      if (target.name !== preset.name.trim()) await MatriboxSession.#saveLoaded(unit, target.index, target.name, preset);
      return [
        `Saved the loaded preset to ${target.label} "${target.name}".`,
        `Written whole into ${target.label} (unsaved edits included); ${target.label} is now the loaded preset.`,
        `Backup of the old ${target.label}: ${backup}`,
      ];
    } catch (error) {
      const kept = await this.#writeBackup(mbPresetLabel(current), current, loaded, 'edit-buffer');
      throw new Error(`${reason(error)}; the loaded ${mbPresetLabel(current)} with its edits: ${kept}`, { cause: error });
    }
  }

  /** The loaded preset (default, unsaved edits included) or slot `preset` as a .prst file in the presets folder. */
  exportPreset(options: { preset?: string; file?: string }): Promise<string> {
    const asked = options.preset === undefined ? null : parseMbPresetLabel(options.preset);
    return this.#use(async (unit) => {
      const current = await mbReadLoadedIndex(unit);
      const index = asked ?? current;
      const elsewhere = index !== current;
      // Another slot reads true only once loaded; the original preset is loaded again after.
      const data = elsewhere ? await mbReadSlot(unit, index) : await unit.read(mbReadPreset(index));
      if (elsewhere) await unit.write(mbSelectPreset(current));
      const preset = parseMbPreset(data);
      const path = await writeMatriboxPrstFile(this.#folders.presets, preset, mbPresetLabel(index), options.file);
      const note = elsewhere ? [`${mbPresetLabel(index)} was loaded to read it, then ${mbPresetLabel(current)} again: unsaved edits of ${mbPresetLabel(current)} are lost.`] : [];
      return [`Exported ${mbPresetLabel(index)} "${preset.name}" to ${path}`, ...note].join('\n');
    });
  }

  /** Stores a .prst whole in slot `preset` (confirmed by its label), as Sonicake's app imports one. */
  async importPreset(options: { file: string; preset: string; name?: string; confirm: string }): Promise<string> {
    const preset = await readMatriboxPrst(this.#folders.presets, options.file);
    const target = checkSave(options.preset, options.confirm, options.name ?? preset.name);
    return this.#use(async (unit) => [...(await this.#store(unit, target, preset)), UNCHECKED].join('\n'));
  }

  /** Stores a backup save_preset wrote back in its own slot (itself backed up first). */
  async restoreBackup(options: { file: string; confirm: string; name?: string }): Promise<string> {
    const backup = await readMatriboxBackup(this.#folders.backups, options.file);
    const target = checkSave(backup.label, options.confirm, options.name ?? backup.name);
    return this.#use(async (unit) => [...(await this.#store(unit, target, backup.preset)), UNCHECKED].join('\n'));
  }

  /** All 240 slots, each read once loaded, in one file in the backups folder; the loaded preset is loaded again after. */
  backupAllPresets(options: { file?: string }): Promise<string> {
    return this.#use(async (unit) => {
      const current = mbPresetLabel(await mbReadLoadedIndex(unit));
      const path = await writeMatriboxBackupAll(this.#folders.backups, await mbBackupAllPresets(unit), options.file);
      return [`Backed up all 240 presets to ${path}`, `Each slot was loaded to read it, then ${current} again: unsaved edits of ${current} are lost.`].join('\n');
    });
  }

  /** Writes every preset of a backup-all file into its slot (after a backup-all of the unit, unless `backup` is false). */
  async restoreAllPresets(options: { file: string; confirm: string; backup?: boolean }): Promise<string> {
    if (options.confirm.trim().toUpperCase() !== 'ALL') throw new Error('confirm must be "ALL": the restore overwrites every preset in the file');
    const file = await readMatriboxBackupAll(this.#folders.backups, options.file); // checked before the unit is opened
    return this.#use(async (unit) => {
      const before = options.backup === false ? null : await writeMatriboxBackupAll(this.#folders.backups, await mbBackupAllPresets(unit));
      const note = before ? [`Backup of all 240 presets before the restore: ${before}`] : [];
      const { written } = await mbRestoreAllPresets(unit, file).catch((error: unknown) => {
        throw new Error([reason(error), ...note].join('\n'), { cause: error });
      });
      return [`Restored ${written.length} presets: ${written.join(', ')}.`, ...note, UNCHECKED].join('\n');
    });
  }

  /**
   * Stores `preset` whole (chain, parameters, knob, expression and footswitch assignments, volume,
   * tempo) in slot `index` with the official editor's one-message write, which the unit keeps in
   * that slot (captures mb-20 and midi-123). A different `name` is then given with a save.
   */
  async #store(unit: MatriboxConnection, target: Target, preset: MbPreset): Promise<string[]> {
    const { label } = target;
    const backup = await this.#storeWhole(unit, target, preset);
    const catalog = await this.#catalogOnce().catch(() => undefined); // without the app: module numbers
    const modules = catalog ? resolveMbPreset(preset, catalog).chain.map((b) => b.module) : preset.chain.map((b) => `module ${b.moduleIndex}`);
    const lines = [
      `Stored "${preset.name}" in ${label} in one write: chain, parameters, knob, expression-pedal and footswitch assignments, volume and tempo. ${label} is now the loaded preset.`,
      `Chain: ${modules.join(' → ')}`,
      `Backup of the old ${label}: ${backup}`,
    ];
    if (target.name === preset.name.trim()) return lines;
    await MatriboxSession.#saveLoaded(unit, target.index, target.name, preset);
    return [...lines, `Saved the loaded preset to ${label} "${target.name}".`];
  }

  /** Like the official app: load the slot, back up what it stores, write `preset` whole, read it back. Returns the backup's path. */
  async #storeWhole(unit: MatriboxConnection, { index, label }: Target, preset: MbPreset): Promise<string> {
    const backup = await this.#writeBackup(label, index, await mbReadSlot(unit, index));
    await mbStoreSlot(unit, index, preset).catch((error: unknown) => {
      throw new Error(`${reason(error)} (backup of ${label} kept: ${backup})`, { cause: error });
    });
    return backup;
  }

  /** Saves the loaded slot `index` under `name` (cmd 05, unanswered), checked by reading it back. */
  static async #saveLoaded(unit: MatriboxConnection, index: number, name: string, loaded: MbPreset): Promise<void> {
    unit.post(mbSavePreset(index, name));
    await MatriboxSession.#checkSaved(unit, index, name, loaded);
  }

  /** A save is checked by reading the (loaded) slot back: the name in the preset list, the chain and the parameters. */
  static async #checkSaved(unit: MatriboxConnection, index: number, name: string, loaded: MbPreset): Promise<void> {
    const sameAs = (preset: MbPreset, id: number) => sectionHex(preset, id) === sectionHex(loaded, id);
    for (let attempt = 0; attempt < SAVE_CHECKS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, SAVE_CHECK_MS));
      const listed = parseMbPresetNames(await unit.read(mbReadPresetNames()))[index]?.name.trim();
      const stored = parseMbPreset(await unit.read(mbReadPreset(index)));
      if (listed === name && sameAs(stored, 4) && sameAs(stored, 5)) return;
    }
    throw new Error(`${mbPresetLabel(index)} does not hold "${name}" after the save: the unit did not store it`);
  }

  /** `source`: "slot" when read with the slot loaded (what it stores), "edit-buffer" for the loaded preset with its unsaved edits. */
  async #writeBackup(label: string, index: number, data: Uint8Array, source: 'slot' | 'edit-buffer' = 'slot'): Promise<string> {
    const createdAt = new Date().toISOString();
    const file = { device: MATRIBOX_DEVICE, label, index, name: parseMbPreset(data).name, createdAt, source, preset: toHex(data) };
    await mkdir(this.#folders.backups, { recursive: true });
    const base = join(this.#folders.backups, `${createdAt.replace(/[:.]/g, '-')}-matribox-${label}`);
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
}
