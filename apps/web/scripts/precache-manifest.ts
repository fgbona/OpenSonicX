import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CACHE_PREFIX, precacheUrls } from '../lib/precache.ts';

export interface PrecacheManifest {
  /** The release's cache: the app version plus a digest of every precached file (path and content). */
  readonly cacheName: string;
  readonly urls: readonly string[];
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));

/** What the service worker of the static export in `dir` precaches, and under which cache. */
export function precacheManifest(dir: string, basePath: string, version: string): PrecacheManifest {
  const urls = precacheUrls(filesUnder(dir), basePath);
  const digest = createHash('sha256');
  for (const url of urls) {
    digest.update(url).update('\0').update(readFileSync(join(dir, url.slice(basePath.length + 1)))).update('\0');
  }
  return { cacheName: `${CACHE_PREFIX}${version}-${digest.digest('hex').slice(0, 10)}`, urls };
}
