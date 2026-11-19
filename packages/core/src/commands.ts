import { isGlobalWrite } from './globals.ts';
import { buildFrame, parseFrame } from './frame.ts';
import { MessageType } from './queries.ts';
import { CLONE_MODULE, type ParamSpec } from './catalog.ts';

/** Second payload byte of the set commands the live editor may send. */
export const EditCommand = { PRESET_FIELD: 0x42, CHAIN: 0x44, MODEL: 0x47, PARAM: 0x48, BLOCK_ON: 0x49, FOOTSWITCH: 0x4d } as const;
const ALLOWED_EDITS: ReadonlySet<number> = new Set(Object.values(EditCommand));

const MODULE_COUNT = 9;
/** DRV, AMP, IR, EQ always stay together, in this order. */
export const FIXED_GROUP: readonly number[] = [2, 3, 4, 5];
/** Module 9 in a block on/off command switches amp mode: 0 amp model, 1 captured profile. */
const AMP_MODE_MODULE = CLONE_MODULE;
const CHAIN_TERMINATOR = 9;

const u32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return Array.from(b);
};
const f32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return Array.from(b);
};
const set = (command: number, ...args: number[]) => buildFrame([MessageType.SET, command, ...args]);

export function setBlockOn(module: number, on: boolean): Uint8Array {
  return set(EditCommand.BLOCK_ON, ...u32(module), ...u32(on ? 1 : 0));
}

export function setAmpMode(clone: boolean): Uint8Array {
  return setBlockOn(AMP_MODE_MODULE, clone);
}

/** The module id is sent twice; that is the captured format. */
export function selectModel(module: number, code: number): Uint8Array {
  return set(EditCommand.MODEL, ...u32(module), ...u32(module), ...u32(code));
}

export function setParam(module: number, alg: number, value: number): Uint8Array {
  return set(EditCommand.PARAM, ...u32(module), ...u32(alg), ...f32(value));
}

export function setChain(order: readonly number[]): Uint8Array {
  validateChain(order);
  return set(EditCommand.CHAIN, ...order, CHAIN_TERMINATOR);
}

export function validateChain(order: readonly number[]): void {
  const sorted = [...order].sort((a, b) => a - b);
  if (order.length !== MODULE_COUNT || sorted.some((m, i) => m !== i)) {
    throw new Error('the chain must contain each of the 9 blocks exactly once');
  }
  const start = order.indexOf(FIXED_GROUP[0] as number);
  if (FIXED_GROUP.some((m, i) => order[start + i] !== m)) {
    throw new Error('DRV, AMP, IR and EQ must stay together, in this order');
  }
}

/** True only for chain, model, parameter, block on/off and preset volume commands. Never save, select or globals. */
export function isAllowedEdit(sysex: Uint8Array): boolean {
  try {
    const f = parseFrame(sysex);
    return f.crcOk && f.total === 1 && f.payload[0] === MessageType.SET && ALLOWED_EDITS.has(f.payload[1] ?? -1);
  } catch {
    return false;
  }
}

/** True for a device-wide setting or EXP/FS target write, the other thing the edit queue takes. */
export function isAllowedGlobalWrite(sysex: Uint8Array): boolean {
  try {
    const f = parseFrame(sysex);
    return f.crcOk && f.total === 1 && isGlobalWrite(f.payload);
  } catch {
    return false;
  }
}

/**
 * Queue key of an edit command, derived from its bytes: command plus module (plus slot for a
 * parameter). Two commands with the same key set the same thing, so the older one can be dropped.
 * The amp-mode switch (11 49, module 9) and an amp model (11 47, module 3) never share a key.
 */
export function editKey(sysex: Uint8Array): string {
  const { payload } = parseFrame(sysex);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const command = payload[1] ?? 0;
  if (command === EditCommand.CHAIN) return 'chain';
  // A setting is keyed by its address (11 11 a0 a1), a target by register and slot (11 16|17 sub).
  if (isGlobalWrite(payload)) return payload[1] === 0x11 ? `global:${payload[2]}:${payload[3]}` : `target:${payload[1]}:${payload[2]}`;
  // 11 42 <field>: field 1 is the preset volume, 2 the BPM; each has its own key.
  if (command === EditCommand.PRESET_FIELD) return `field:${payload[2]}`;
  if (command === EditCommand.FOOTSWITCH) return `footswitch:${payload[2]}:${payload[3]}`;
  const module = view.getUint32(2, true);
  return command === EditCommand.PARAM ? `${command}:${module}:${view.getUint32(6, true)}` : `${command}:${module}`;
}

export type Footswitch = 'fs1' | 'fs2';

/**
 * Adds a block to, or removes it from, one footswitch: `11 4D <switch> <module> <on>`, switch 0 for
 * FS1 and 1 for FS2. It toggles one membership; moving a block to the other switch takes two.
 * Protocol from SonicMaster (github.com/skyggedans/SonicMaster, MIT), checked there against
 * captured writes; not yet sent from this editor to a unit.
 */
export function setFootswitch(footswitch: Footswitch, module: number, on: boolean): Uint8Array {
  if (!Number.isInteger(module) || module < 0 || module >= MODULE_COUNT) throw new Error(`module must be 0..${MODULE_COUNT - 1}`);
  return buildFrame([MessageType.SET, EditCommand.FOOTSWITCH, footswitch === 'fs2' ? 1 : 0, module, on ? 1 : 0]);
}

/** Validates a user value against the catalog spec and returns the float the pedal expects. */
export function encodeValue(spec: ParamSpec, input: number | boolean | string): number {
  if (spec.type === 'switch') return input === true || input === 1 || input === 'on' ? 1 : 0;
  if (spec.type === 'select') {
    const options = spec.options ?? [];
    const index = typeof input === 'string' ? options.indexOf(input) : Number(input);
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      throw new Error(`${spec.name} options: ${options.join(', ')}`);
    }
    return index;
  }
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const step = spec.step ?? 1;
  const value = Number(input);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${spec.name} must be ${min}..${max}${spec.unit ? ' ' + spec.unit : ''}, got ${input}`);
  }
  const digits = Number.isInteger(step) ? 0 : (String(step).split('.')[1]?.length ?? 0);
  return Number((min + Math.round((value - min) / step) * step).toFixed(digits));
}
