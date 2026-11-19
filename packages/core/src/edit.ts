import { findCloneModel, findModel, CLONE_MODULE, type ModelSpec } from './catalog.ts';
import { setAmpMode, selectModel, setBlockOn, setChain, setFootswitch, setParam, validateChain, type Footswitch } from './commands.ts';
import { modelOf, toParam, type Block, type Preset } from './dump.ts';
import { setPresetBpm, setPresetVolume } from './slots.ts';

/** The most blocks one footswitch can toggle. */
export const FOOTSWITCH_CAPACITY = 3;

const AMP_MODULE = 3;
const IR_MODULE = 4;
const NR_MODULE = 0;

/** One change to the edit buffer. Values are already encoded (see encodeValue). */
export type Edit =
  | { readonly kind: 'param'; readonly module: number; readonly alg: number; readonly value: number }
  | { readonly kind: 'on'; readonly module: number; readonly on: boolean }
  /** `clone` selects a captured amp profile; only used to restore a preset that had one. */
  | { readonly kind: 'model'; readonly module: number; readonly code: number; readonly clone?: boolean }
  | { readonly kind: 'chain'; readonly order: readonly number[] }
  | { readonly kind: 'volume'; readonly value: number }
  | { readonly kind: 'bpm'; readonly value: number }
  /** Puts a block on FS1 or FS2, or (null) on none. */
  | { readonly kind: 'footswitch'; readonly module: number; readonly footswitch: Footswitch | null };

/** The preset after an edit, as the pedal will hold it. Returns a new object; the input is not changed. */
export function applyEdit(preset: Preset, edit: Edit): Preset {
  switch (edit.kind) {
    case 'volume':
      setPresetVolume(edit.value); // validates 0..100
      return { ...preset, volume: edit.value };
    case 'bpm':
      setPresetBpm(edit.value); // validates the range
      return { ...preset, bpm: edit.value };
    case 'footswitch':
      return mapBlock(preset, edit.module, (b) => ({ ...b, footswitch: edit.footswitch }));
    case 'chain': {
      validateChain(edit.order);
      const byModule = new Map(preset.chain.map((b) => [b.module, b]));
      return { ...preset, chain: edit.order.map((m) => byModule.get(m) as Block) };
    }
    case 'on':
      return mapBlock(preset, edit.module, (b) => ({ ...b, on: edit.on }));
    case 'param':
      return mapBlock(preset, edit.module, (b) => {
        const spec = modelOf(preset, b)?.params.find((p) => p.alg === edit.alg);
        if (!spec) throw new Error(`${b.label} (${b.model}) has no parameter in slot ${edit.alg}`);
        return { ...b, params: b.params.map((p) => (p.alg === edit.alg ? toParam(spec, edit.value) : p)) };
      });
    case 'model': {
      const clone = edit.module === AMP_MODULE && edit.clone === true;
      // A code the catalog does not know (new firmware) is still applied; its parameters are unknown.
      const model = findModelFor(preset, edit.module, edit.code, clone);
      const next = mapBlock(preset, edit.module, (b) => ({
        ...b,
        code: edit.code,
        model: model?.name ?? `0x${edit.code.toString(16).toUpperCase().padStart(8, '0')}`,
        params: model ? model.params.map((p) => toParam(p, p.default ?? p.min ?? 0)) : [],
      }));
      if (edit.module !== AMP_MODULE) return next;
      // The unit turns IR off when a captured profile is picked on it and back on when it leaves
      // clone mode, but not when the change arrives over MIDI, so the editor does the same itself.
      const leavingClone = preset.ampMode === 'clone' && !clone;
      const withMode: Preset = { ...next, ampMode: clone ? 'clone' : 'normal' };
      if (clone) return mapBlock(withMode, IR_MODULE, (b) => ({ ...b, on: false }));
      return leavingClone ? mapBlock(withMode, IR_MODULE, (b) => ({ ...b, on: true })) : withMode;
    }
  }
}

/** The SysEx messages that perform an edit on the pedal, in order. */
export function editToCommands(preset: Preset, edit: Edit): Uint8Array[] {
  switch (edit.kind) {
    case 'volume':
      return [setPresetVolume(edit.value)];
    case 'bpm':
      return [setPresetBpm(edit.value)];
    case 'footswitch':
      return footswitchCommands(preset, edit.module, edit.footswitch);
    case 'chain':
      return [setChain(edit.order)];
    case 'on':
      return [setBlockOn(edit.module, edit.on)];
    case 'param': {
      // AMP parameters of a captured profile live in module 9.
      const module = edit.module === AMP_MODULE && preset.ampMode === 'clone' ? CLONE_MODULE : edit.module;
      return [setParam(module, edit.alg, edit.value)];
    }
    case 'model': {
      if (edit.module === NR_MODULE) throw new Error('NR has a single model (Gate)');
      const clone = edit.module === AMP_MODULE && edit.clone === true;
      if (edit.module !== AMP_MODULE) return [selectModel(edit.module, edit.code)];
      const modeSwitch = (preset.ampMode === 'clone') !== clone ? [setAmpMode(clone)] : [];
      const leavingClone = preset.ampMode === 'clone' && !clone;
      const ir = clone ? [setBlockOn(IR_MODULE, false)] : leavingClone ? [setBlockOn(IR_MODULE, true)] : [];
      return [...modeSwitch, selectModel(clone ? CLONE_MODULE : AMP_MODULE, edit.code), ...ir];
    }
  }
}

/**
 * Edits that turn `from` into `to`: chain first, then models (which reset parameters
 * to their defaults), then on/off, then every parameter that still differs, then volume, BPM
 * and footswitches.
 */
export function diffPresets(from: Preset, to: Preset): Edit[] {
  const edits: Edit[] = [];
  const order = to.chain.map((b) => b.module);
  if (order.some((m, i) => from.chain[i]?.module !== m)) edits.push({ kind: 'chain', order });

  const target = new Map(to.chain.map((b) => [b.module, b]));
  const afterModels = from.chain.reduce((state, b) => {
    const want = target.get(b.module) as Block;
    const ampModeDiffers = b.module === AMP_MODULE && from.ampMode !== to.ampMode;
    if (want.code === b.code && !ampModeDiffers) return state;
    const edit: Edit = { kind: 'model', module: b.module, code: want.code, clone: b.module === AMP_MODULE && to.ampMode === 'clone' };
    edits.push(edit);
    return applyEdit(state, edit);
  }, from);

  for (const b of afterModels.chain) {
    const want = target.get(b.module) as Block;
    if (want.on !== b.on) edits.push({ kind: 'on', module: b.module, on: want.on });
    for (const p of want.params) {
      if (b.params.find((x) => x.alg === p.alg)?.value !== p.value) {
        edits.push({ kind: 'param', module: b.module, alg: p.alg, value: p.value });
      }
    }
  }
  if (to.volume !== null && to.volume !== from.volume) edits.push({ kind: 'volume', value: to.volume });
  if (to.bpm !== null && to.bpm !== from.bpm) edits.push({ kind: 'bpm', value: to.bpm });
  // Footswitches: first take blocks off the switches they leave, then add, so a switch never
  // holds more than FOOTSWITCH_CAPACITY blocks on the way.
  const moving = afterModels.chain.filter((b) => (target.get(b.module) as Block).footswitch !== b.footswitch);
  for (const b of moving) if (b.footswitch !== null) edits.push({ kind: 'footswitch', module: b.module, footswitch: null });
  for (const b of moving) {
    const want = (target.get(b.module) as Block).footswitch;
    if (want !== null) edits.push({ kind: 'footswitch', module: b.module, footswitch: want });
  }
  return edits;
}

/** Adds the block to the target switch (if any) first, then takes it off the one it leaves. */
function footswitchCommands(preset: Preset, module: number, target: Footswitch | null): Uint8Array[] {
  const block = preset.chain.find((b) => b.module === module);
  if (!block) throw new Error(`no block with module ${module}`);
  if (block.footswitch === target) return [];
  if (target !== null) {
    const used = preset.chain.filter((b) => b.footswitch === target).length;
    if (used >= FOOTSWITCH_CAPACITY) {
      throw new Error(`${target.toUpperCase()} already switches ${FOOTSWITCH_CAPACITY} blocks; take one off it first`);
    }
  }
  return [
    ...(target !== null ? [setFootswitch(target, module, true)] : []),
    ...(block.footswitch !== null ? [setFootswitch(block.footswitch, module, false)] : []),
  ];
}

function mapBlock(preset: Preset, module: number, fn: (b: Block) => Block): Preset {
  if (!preset.chain.some((b) => b.module === module)) throw new Error(`no block with module ${module}`);
  return { ...preset, chain: preset.chain.map((b) => (b.module === module ? fn(b) : b)) };
}

function findModelFor(preset: Preset, module: number, code: number, clone: boolean): ModelSpec | undefined {
  if (clone) return findCloneModel(code);
  const block = preset.chain.find((b) => b.module === module);
  return block ? findModel(block.key, code) : undefined;
}
