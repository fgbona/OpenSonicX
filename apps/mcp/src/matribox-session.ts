/**
 * The Matribox II Pro as the MCP tools see it (read-only for now). Like the Pocket Master session,
 * every call opens its own connection and closes it, and calls run one at a time. The model catalog
 * comes from the user's install of Sonicake's official editor; it is loaded once, when first needed.
 */
import {
  mbPresetLabel, mbReadCloneNames, mbReadCurrentPresetNumber, mbReadIrNames, mbReadPreset, mbReadPresetNames,
  parseMbCloneNames, parseMbCurrentPresetNumber, parseMbIrNames, parseMbPreset, parseMbPresetNames, resolveMbPreset,
  type MbCatalog, type MbModel, type MbModule, type MbResolvedBlock,
} from '@pocket-master/core';
import type { MatriboxConnection } from './matribox-link.ts';

const round = (n: number) => String(Number(n.toFixed(2)));
/** The real gear a model is based on, on one line; '' when the catalog gives none or only a number. */
const gear = (model: MbModel) => (/[a-z]/i.test(model.origin) ? model.origin.replace(/\s+/g, ' ').trim() : '');
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
  #catalog: Promise<MbCatalog> | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(connect: () => MatriboxConnection | Promise<MatriboxConnection>, loadCatalog: () => Promise<MbCatalog>) {
    this.#connect = connect;
    this.#loadCatalog = loadCatalog;
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
}
