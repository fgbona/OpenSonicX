/**
 * The offline service worker of the static export, bundled into out/sw.js by scripts/build-sw.ts,
 * which defines the release's cache and file list. Cache-first for those files only: requests to
 * other origins (AI providers, TONE3000), non-GET requests and anything not in the export go to
 * the network untouched, and nothing the user makes is ever cached. A new release installs
 * beside the running one and waits until the page asks it to take over (the update prompt) or
 * every tab of the old one is closed, so an edit in progress is never reloaded away.
 */
import { cacheKeyFor, isStaleCache, SKIP_WAITING } from './precache.ts';

declare const __CACHE_NAME__: string;
declare const __PRECACHE__: readonly string[];
declare const __BASE_PATH__: string;

// The few service-worker types used here (the project compiles against the DOM library).
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(r: Promise<Response>): void;
}
interface WorkerScope {
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  readonly location: Location;
}
const sw = self as unknown as WorkerScope;
const PRECACHED = new Set(__PRECACHE__);

sw.addEventListener('install', (event) => {
  // 'reload' skips the HTTP cache, so no stale file of the previous release lands in this one.
  event.waitUntil(caches.open(__CACHE_NAME__).then((cache) => cache.addAll(__PRECACHE__.map((url) => new Request(url, { cache: 'reload' })))));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => isStaleCache(n, __CACHE_NAME__)).map((n) => caches.delete(n))))
      // The first install controls the open page at once, so it works offline without a reload.
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING) void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  const key = cacheKeyFor(url.pathname, __BASE_PATH__, request.mode === 'navigate');
  if (!key || !PRECACHED.has(key)) return;
  event.respondWith(
    caches
      .open(__CACHE_NAME__)
      .then((cache) => cache.match(key))
      .then((hit) => hit ?? fetch(request)),
  );
});
