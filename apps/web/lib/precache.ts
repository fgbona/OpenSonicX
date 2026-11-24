/**
 * What the service worker (lib/sw.ts) keeps for offline use, shared with the build step that
 * lists the static export (scripts/build-sw.ts). Browser-safe: no Node imports.
 */

/** Every cache of this app starts with it; one cache per release, named by scripts/precache-manifest.ts. */
export const CACHE_PREFIX = 'opensonicx-';

/** Files of the export never precached: the worker itself, link-preview images, source maps. */
const SKIPPED = [/^sw\.js$/, /^opengraph-image\./, /\.map$/, /(^|\/)\.DS_Store$/];

/** The URLs (under basePath) of the export's files (relative paths, '/'-separated) to precache, sorted. */
export function precacheUrls(files: readonly string[], basePath: string): string[] {
  return files
    .filter((f) => !SKIPPED.some((re) => re.test(f)))
    .map((f) => `${basePath}/${f}`)
    .sort();
}

/**
 * The precached URL a request path is served from, like GitHub Pages does: a folder is its
 * index.html, a page (a navigation without an extension) its .html. Null outside basePath.
 */
export function cacheKeyFor(pathname: string, basePath: string, navigation: boolean): string | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  const rel = pathname.slice(basePath.length) || '/';
  if (rel.endsWith('/')) return `${basePath}${rel}index.html`;
  const last = rel.slice(rel.lastIndexOf('/') + 1);
  return navigation && !last.includes('.') ? `${basePath}${rel}.html` : `${basePath}${rel}`;
}

/** A cache of an older release of this app (dropped when a new one activates). */
export const isStaleCache = (name: string, current: string) => name.startsWith(CACHE_PREFIX) && name !== current;

/** The message a waiting service worker activates on (the "reload" of the update prompt). */
export const SKIP_WAITING = 'skip-waiting';
