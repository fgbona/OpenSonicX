/**
 * The Matribox II Pro as the MCP tools see it. Like the Pocket Master session, every call opens its
 * own connection and closes it, and calls run one at a time. The model catalog comes from the user's
 * install of Sonicake's official editor; it is loaded once, when first needed. Writes (experimental,
 * not validated on the hardware yet) change the loaded preset; only savePreset stores it, after a
 * backup of the slot it overwrites.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkMbPresetName, mbPresetLabel, mbReadCloneNames, mbReadCurrentPresetNumber, mbReadIrNames, mbReadPreset, mbReadPresetNames,
  mbAddBlock, mbChangeModel, mbRemoveBlock, mbSavePreset, mbSelectPreset, mbSetBlockOn, mbSetParam, parseMbPresetLabel, toHex,
  parseMbCloneNames, parseMbCurrentPresetNumber, parseMbIrNames, parseMbPreset, parseMbPresetNames, resolveMbPreset,
  type MbCatalog, type MbModel, type MbModule, type MbPreset, type MbResolvedBlock, type MbResolvedPreset,
} from '@pocket-master/core';
import type { MatriboxConnection } from './matribox-link.ts';
import {
  checkParam, describeValues, EXPERIMENTAL, findBlock, findModel, gear, knownModel, modelTitle, modelValues, planTone, type ParamWrite, type ToneBlock,
} from './matribox-edit.ts';

const round = (n: number) => String(Number(n.toFixed(2)));
const experimental = (lines: readonly string[]) => [...lines, EXPERIMENTAL].join('\n');
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

export class MatriboxSession {
  readonly #connect: () => MatriboxConnection | Promise<MatriboxConnection>;
  readonly #loadCatalog: () => Promise<MbCatalog>;
  readonly #backups: string;
  #catalog: Promise<MbCatalog> | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  /** `backups`: the folder savePreset keeps the overwritten slots in. */
  constructor(connect: () => MatriboxConnection | Promise<MatriboxConnection>, loadCatalog: () => Promise<MbCatalog>, backups: string) {
    this.#connect = connect;
    this.#loadCatalog = loadCatalog;
    this.#backups = backups;
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

  listCaptures(): Promise<string> {
    return this.#use(async (unit) => parseMbCloneNames(await unit.read(mbReadCloneNames())).map((name, i) => `Capture ${i + 1}: ${name.trim()}`).join('\n'));
  }

  /** The loaded preset, raw and named from the catalog. */
  async #loaded(unit: MatriboxConnection): Promise<{ catalog: MbCatalog; raw: MbPreset; preset: MbResolvedPreset }> {
    const catalog = await this.#catalogOnce();
    const current = parseMbCurrentPresetNumber(await unit.read(mbReadCurrentPresetNumber()));
    const raw = parseMbPreset(await unit.read(mbReadPreset(current)));
    return { catalog, raw, preset: resolveMbPreset(raw, catalog) };
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
      await unit.write(mbChangeModel(block.position - 1, module.index, model.fxid));
      const now = findBlock((await this.#loaded(unit)).preset, String(block.position));
      const values = now.params.map((p) => `${p.name} ${round(p.value)}`).join(', ');
      return experimental([`${module.name}: ${block.model?.name ?? 'unknown model'} → ${modelTitle(model)}${values ? `: ${values}` : ''}`]);
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

  /** Stores the loaded preset in slot `preset` under `name`, after a backup of what the slot holds. */
  savePreset(options: { preset: string; name: string; confirm: string }): Promise<string> {
    const index = parseMbPresetLabel(options.preset);
    const label = mbPresetLabel(index);
    if (options.confirm.trim().toUpperCase() !== label) throw new Error(`confirm must be "${label}" to write that slot`);
    const name = checkMbPresetName(options.name);
    return this.#use(async (unit) => {
      const old = await unit.read(mbReadPreset(index));
      const backup = await this.#writeBackup(label, index, old);
      try {
        await unit.write(mbSavePreset(index, name));
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} (backup kept: ${backup})`, { cause: error });
      }
      return experimental([`Saved the loaded preset to ${label} "${name}".`, `Backup of the old ${label}: ${backup}`]);
    });
  }

  async #writeBackup(label: string, index: number, data: Uint8Array): Promise<string> {
    const createdAt = new Date().toISOString();
    const file = { device: 'Sonicake Matribox II Pro', label, index, name: parseMbPreset(data).name, createdAt, preset: toHex(data) };
    await mkdir(this.#backups, { recursive: true });
    const base = join(this.#backups, `${createdAt.replace(/[:.]/g, '-')}-matribox-${label}`);
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
