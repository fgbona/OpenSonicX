/**
 * Reads the Matribox II Pro model catalog from the user's own install of Sonicake's official
 * editor. The file is Sonicake's: it is never copied into this project or shipped with it.
 */
import { readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { parseMbCatalog, type MbCatalog } from '@pocket-master/core';

const APP = 'Matribox II PRO';
const ASSET = ['flutter_assets', 'assets', 'alg', 'alg_data.json'];
const MAC_PATH = posix.join('/Applications', `${APP}.app`, 'Contents', 'Frameworks', 'App.framework', 'Resources', ...ASSET);

/**
 * Where alg_data.json is: MATRIBOX_CATALOG if set, else the official app's default install.
 * The Windows path is the usual Flutter layout under Program Files, not yet checked on a real install.
 */
export function matriboxCatalogPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (env.MATRIBOX_CATALOG !== undefined) return env.MATRIBOX_CATALOG.trim() || null;
  if (platform === 'darwin') return MAC_PATH;
  if (platform === 'win32') return win32.join(env.ProgramFiles ?? 'C:\\Program Files', APP, 'data', ...ASSET);
  return null;
}

export async function loadMatriboxCatalog(path: string | null = matriboxCatalogPath()): Promise<MbCatalog> {
  if (!path) throw new Error(`No Matribox II PRO catalog: set MATRIBOX_CATALOG to the alg_data.json of Sonicake's official ${APP} editor.`);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Matribox II PRO catalog not found at ${path}: install Sonicake's official ${APP} editor, or set MATRIBOX_CATALOG to its alg_data.json.`, { cause: err });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Matribox II PRO catalog at ${path} is not valid JSON.`, { cause: err });
  }
  return parseMbCatalog(json);
}
