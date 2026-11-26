/**
 * A NAM capture (.nam) or a ready capture (.clo) into one of the Matribox II Pro's 10 CLONE slots:
 * a .nam is converted the official editor's way (generateMatriboxClo, in a worker thread), every
 * capture is played through the simulated CLONE block first (checkClo: silent, far too loud or
 * broken is refused), then uploaded (mbUploadClone: acknowledged, renamed, read back). The unit
 * cannot send a capture back, so an occupied slot (its name is not the default "Clone n") is only
 * overwritten when asked.
 */
import { Worker } from 'node:worker_threads';
import { checkClo, checkMbCloneName, cloProbe, decodeClo, MB_CLONE_SLOTS, mbDefaultCloneName, mbReadCloneNames, mbUploadClone, parseMbCloneNames, parseNam } from '@pocket-master/core';
import type { MatriboxConnection } from './devices.ts';

export const MB_CLONE_UNCHECKED =
  "Experimental: the conversion ports the official editor's fit (waveod's reconstruction) and the upload rebuilds the official editor's byte for byte; neither is checked on the unit yet. Listen to it in a CLONE block before using it in a preset.";
const MAGIC = [0x56, 0x54, 0x53, 0x49]; // 'VTSI'
const NAME_MAX = 16;

/** .nam JSON -> .clo bytes; `onProgress` gets the share done, 0..1. */
export type CloneConverter = (namJson: string, onProgress?: (fraction: number) => void) => Promise<Uint8Array>;

const workerUrl = () => new URL(import.meta.url.endsWith('.ts') ? './clone-worker.ts' : './clone-worker.js', import.meta.url);

/** The conversion in a worker thread, so the server keeps answering meanwhile; `loadDi` gives the 70 s reference DI. */
export function nodeCloneConverter(loadDi: () => Promise<Float32Array>): CloneConverter {
  return async (namJson, onProgress) => {
    parseNam(namJson); // refuse unsupported captures before downloading anything
    const di = await loadDi();
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl(), { workerData: { namJson, di } });
      worker.on('message', (m: number | Uint8Array) => (typeof m === 'number' ? onProgress?.(m) : resolve(new Uint8Array(m))));
      worker.once('error', reject);
      worker.once('exit', (code) => code !== 0 && reject(new Error(`clone conversion worker stopped (exit ${code})`)));
    });
  };
}

export interface MatriboxCloneOptions {
  /** 1-based, 1..10. */
  readonly slot: number;
  readonly confirm: string;
  readonly name?: string;
  readonly replace?: boolean;
}

/** Printable ASCII, cut to 16 characters, from a file or model name without folder and extension. */
export function cloneNameFrom(source: string): string {
  const base = source.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  const name = base
    .replace(/[^\x20-\x7e]/g, '_')
    .slice(0, NAME_MAX)
    .trim();
  return name === '' ? 'NAM capture' : name;
}

/** Checks slot, confirm and name, then makes the .clo (converting a .nam) and plays it through the simulated block. */
export async function prepareMatriboxClone(bytes: Uint8Array, sourceName: string, options: MatriboxCloneOptions, convert: CloneConverter): Promise<{ clo: Uint8Array; name: string; level: string }> {
  const { slot } = options;
  if (!Number.isInteger(slot) || slot < 1 || slot > MB_CLONE_SLOTS) throw new Error(`slot must be 1..${MB_CLONE_SLOTS}, got ${slot}`);
  if (options.confirm?.trim().toUpperCase() !== `CLONE${slot}`) throw new Error(`confirm must be "CLONE${slot}" to write that slot`);
  const name = checkMbCloneName(options.name ?? cloneNameFrom(sourceName));
  const isClo = MAGIC.every((b, i) => bytes[i] === b);
  let clo: Uint8Array;
  if (isClo) {
    decodeClo(bytes);
    clo = bytes;
  } else {
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith('{')) throw new Error('the file is neither a NAM capture (.nam) nor a Matribox capture (.clo)');
    clo = await convert(text);
  }
  const check = checkClo(clo, cloProbe());
  const level = `${check.rmsDb.toFixed(1)} dB RMS, peak ${check.peak.toFixed(2)} on a test DI`;
  if (!check.ok) {
    const why = { silent: 'plays silence', clipped: 'plays far too loud', broken: 'produces invalid samples' }[check.problem ?? 'broken'];
    throw new Error(`the capture ${why} in the simulated CLONE block (${level}); not uploaded`);
  }
  return { clo, name, level };
}

/** Uploads into CLONE `slot` (refusing an occupied one unless `replace`), then lists the names read back. */
export async function uploadMatriboxClone(unit: MatriboxConnection, slot: number, prepared: { clo: Uint8Array; name: string; level: string }, replace = false): Promise<string> {
  const before = parseMbCloneNames(await unit.read(mbReadCloneNames()));
  const current = before[slot - 1]?.trim() ?? '';
  const occupied = current !== '' && current !== mbDefaultCloneName(slot - 1);
  if (occupied && !replace) throw new Error(`CLONE ${slot} holds "${current}", which cannot be read back from the unit; keep its .nam, then pass replace: true to overwrite it`);
  const after = await mbUploadClone(unit, slot - 1, prepared.clo, { name: prepared.name });
  const list = after.map((n, i) => `CLONE ${i + 1}: ${n.trim()}`).join('\n');
  return [
    `Wrote "${prepared.name}" to CLONE ${slot}${occupied ? ` (replacing "${current}")` : ''}; simulated: ${prepared.level}. Pick it in a CLONE block (capture ${slot}).`,
    MB_CLONE_UNCHECKED,
    '',
    list,
  ].join('\n');
}

const MAX_DOWNLOAD = 50 * 1024 * 1024;

/** A .nam or .clo the person linked: https only, at most 50 MB. */
export async function fetchCapture(url: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a link: "${url}"`);
  }
  if (parsed.protocol !== 'https:') throw new Error('only https links are downloaded');
  const res = await fetcher(parsed);
  if (!res.ok) throw new Error(`could not download ${parsed.href} (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new Error('the download is larger than 50 MB: not a capture');
  return bytes;
}
