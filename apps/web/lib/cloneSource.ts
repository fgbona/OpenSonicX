/** Where a Matribox Clone capture comes from, and the small rules around naming and picking it. */
import { MB_CLONE_SLOTS, mbDefaultCloneName, type ToneModel } from '@pocket-master/core';

/** What the assistant proposes to load: a link to a .nam/.clo, or a TONE3000 tone (and which of its models). */
export type CloneSource = { readonly url: string } | { readonly toneId: number; readonly modelId?: number };

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** A file name as a clone name: no extension, printable ASCII only, at most 16 characters. */
export const cloneNameFromFile = (file: string): string =>
  file
    .replace(/\.[^.]*$/, '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 16)
    .trim();

/** An empty slot lists as its default name ("Clone 3"). */
export const isEmptyClone = (slot: number, name: string): boolean => name.trim() === '' || name.trim() === mbDefaultCloneName(slot);

/** The first empty CLONE slot (0-based), else the first. */
export function firstEmptyClone(names: readonly string[]): number {
  const empty = Array.from({ length: MB_CLONE_SLOTS }, (_, i) => i).find((i) => isEmptyClone(i, names[i] ?? ''));
  return empty ?? 0;
}

/** A .nam is JSON text; a .clo is binary. */
export const isNamFile = (bytes: Uint8Array): boolean => bytes.find((b) => b > 0x20) === 0x7b;

/** Downloads a .nam or .clo the person linked to; a CORS block or an HTTP error is reported with its reason. */
export async function fetchCloneFile(link: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`"${link}" is not a link`);
  }
  if (url.protocol !== 'https:') throw new Error('only https links can be downloaded');
  let res: Response;
  try {
    res = await fetcher(url);
  } catch {
    throw new Error(`could not download ${link}: the site blocked the request (CORS) or the network failed`);
  }
  if (!res.ok) throw new Error(`could not download ${link}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${link} is too large for a capture`);
  return bytes;
}

/** The model of a TONE3000 tone to convert: `modelId`, or the only one; otherwise an error listing them. */
export function pickToneModel(models: readonly ToneModel[], modelId?: number): ToneModel {
  const list = () => models.map((m) => `${m.id}: ${m.name}${m.size ? ` (${m.size})` : ''}`).join('; ');
  if (models.length === 0) throw new Error('this tone has no models');
  if (modelId !== undefined) {
    const model = models.find((m) => m.id === modelId);
    if (!model) throw new Error(`this tone has no model ${modelId}. Models: ${list()}`);
    return model;
  }
  if (models.length > 1) throw new Error(`this tone has several models; call upload_clone again with a modelId. Models: ${list()}`);
  return models[0] as ToneModel;
}
