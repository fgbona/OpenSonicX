/**
 * Matribox II Pro model catalog, parsed from the official editor's alg_data.json. That file is
 * Sonicake's: it is read at run time from the user's own installed app and never shipped here
 * (docs/matribox.md). This parser takes the already-parsed JSON and trusts nothing in it.
 */

export interface MbParam {
  readonly name: string;
  readonly id: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface MbModel {
  readonly fxid: number;
  readonly index: number;
  readonly name: string;
  readonly type: string;
  readonly origin: string;
  readonly style: string;
  readonly description: string;
  readonly params: readonly MbParam[];
}

export interface MbModule {
  readonly name: string;
  readonly index: number;
  readonly models: readonly MbModel[];
}

export interface MbCatalog {
  readonly modules: readonly MbModule[];
}

type Obj = Record<string, unknown>;

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`catalog: ${path} must be an object`);
  return value as Obj;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`catalog: ${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`catalog: ${path} must be a string`);
  return value;
}

/** Descriptive text: missing or null reads as '', a bare number (one model's origin is) as its digits. */
function text(value: unknown, path: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return string(value, path);
}

/** A finite number, given as a number or as a numeric string ("50", "-12", "+3", "0.5"). */
function number(value: unknown, path: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) throw new Error(`catalog: ${path} must be a number, got ${JSON.stringify(value)}`);
  return n;
}

function integer(value: unknown, path: string): number {
  const n = number(value, path);
  if (!Number.isInteger(n)) throw new Error(`catalog: ${path} must be an integer, got ${JSON.stringify(value)}`);
  return n;
}

function parseParam(raw: unknown, path: string): MbParam {
  const w = object(raw, path);
  const [min, max, defaultValue] = [number(w.min, `${path}.min`), number(w.max, `${path}.max`), number(w.defaultValue, `${path}.defaultValue`)];
  const step = number(w.step, `${path}.step`);
  if (step <= 0) throw new Error(`catalog: ${path}.step must be greater than 0`);
  if (min > max || defaultValue < min || defaultValue > max) {
    throw new Error(`catalog: ${path} is out of range (min ${min}, max ${max}, default ${defaultValue})`);
  }
  return Object.freeze({ name: string(w.name, `${path}.name`), id: integer(w.ID, `${path}.ID`), defaultValue, min, max, step });
}

function parseModel(raw: unknown, path: string): MbModel {
  const a = object(raw, path);
  const params = array(a.widget, `${path}.widget`).map((w, i) => parseParam(w, `${path}.widget[${i}]`));
  return Object.freeze({
    fxid: integer(a.fxid, `${path}.fxid`),
    index: integer(a.index, `${path}.index`),
    name: string(a.name, `${path}.name`),
    type: text(a.type, `${path}.type`),
    origin: text(a.origin, `${path}.origin`),
    style: text(a.style, `${path}.style`),
    description: text(a.descriptionEN, `${path}.descriptionEN`),
    params: Object.freeze(params),
  });
}

function parseModule(raw: unknown, path: string): MbModule {
  const m = object(raw, path);
  const name = string(m.name, `${path}.name`);
  const index = integer(m.index, `${path}.index`);
  const models = array(m.alg, `${path}.alg`).map((a, i) => parseModel(a, `${path}.alg[${i}]`));
  return Object.freeze({ name, index, models: Object.freeze(models) });
}

/** Validates and converts the parsed alg_data.json into a frozen catalog. Throws with the path of the first problem. */
export function parseMbCatalog(json: unknown): MbCatalog {
  const root = object(json, 'root');
  const modules = array(root.Modules, 'Modules').map((m, i) => parseModule(m, `Modules[${i}]`));
  return Object.freeze({ modules: Object.freeze(modules) });
}
