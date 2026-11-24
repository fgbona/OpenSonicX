/**
 * Where the Matribox II Pro model catalog (alg_data.json of Sonicake's official editor) is on this
 * computer. The file is Sonicake's: the desktop app never ships it, it serves the user's own copy
 * to the editor at CATALOG_URL_PATH on its app:// origin (same rules as apps/mcp).
 */
import { posix, win32 } from 'node:path';

export const CATALOG_URL_PATH = '/matribox-catalog.json';
const APP = 'Matribox II PRO';
const ASSET = ['flutter_assets', 'assets', 'alg', 'alg_data.json'];

/** MATRIBOX_CATALOG if set, else the official app's default install; null when there is none. */
export function matriboxCatalogPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (env.MATRIBOX_CATALOG !== undefined) return env.MATRIBOX_CATALOG.trim() || null;
  if (platform === 'darwin') return posix.join('/Applications', `${APP}.app`, 'Contents', 'Frameworks', 'App.framework', 'Resources', ...ASSET);
  // The usual Flutter layout under Program Files, not yet checked on a real install.
  if (platform === 'win32') return win32.join(env.ProgramFiles ?? 'C:\\Program Files', APP, 'data', ...ASSET);
  return null;
}
