/**
 * Portuguese for the Matribox model descriptions, translated on this device by the browser's own
 * Translator API (Chrome). The text never goes anywhere: there is no network fallback, and no
 * translation table ships with the app (the catalog is the user's file). A translation is kept in
 * localStorage, keyed by a hash of the English text, so the model is not asked again.
 */

const CACHE_KEY = 'pocket-master-editor.translations.v1';
const AVAILABILITY_MS = 2000;
const PAIR = { sourceLanguage: 'en', targetLanguage: 'pt' } as const;

interface TranslatorInstance {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(options: typeof PAIR): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options: typeof PAIR): Promise<TranslatorInstance>;
}

/** `ready`: translate now; `download`: needs a one-time model download (a user gesture); `none`: not on this browser. */
export type TranslateSupport = 'ready' | 'download' | 'none';

const api = (): TranslatorStatic | null => {
  const t = (globalThis as { Translator?: TranslatorStatic }).Translator;
  return t && typeof t.availability === 'function' && typeof t.create === 'function' ? t : null;
};

export async function translateSupport(): Promise<TranslateSupport> {
  const t = api();
  if (!t) return 'none';
  try {
    // A browser without the model component can leave this pending for good: give up after a moment.
    const state = await Promise.race([t.availability(PAIR), new Promise<'unavailable'>((resolve) => setTimeout(resolve, AVAILABILITY_MS, 'unavailable'))]);
    return state === 'available' ? 'ready' : state === 'unavailable' ? 'none' : 'download';
  } catch {
    return 'none';
  }
}

/** FNV-1a, 32 bits, with the length: a cache key, not a security measure. */
export function textKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(16)}.${text.length}`;
}

function readCache(): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {}; // storage blocked or damaged: translate again
  }
}

export function cachedTranslation(text: string): string | null {
  const hit = readCache()[textKey(text)];
  return typeof hit === 'string' ? hit : null;
}

function remember(text: string, translation: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), [textKey(text)]: translation }));
  } catch {
    // not kept across visits; the translation still shows now
  }
}

let translator: Promise<TranslatorInstance> | null = null;

/** Forgets the translator created so far (tests swap the stubbed Translator between cases). */
export function resetTranslator() {
  translator = null;
}

/**
 * Translates `text` to Portuguese, from the cache when it can. Creating the translator downloads the
 * model when needed, which Chrome allows only inside a user gesture; throws when it cannot translate.
 */
export async function translateToPt(text: string): Promise<string> {
  const hit = cachedTranslation(text);
  if (hit !== null) return hit;
  const t = api();
  if (!t) throw new Error('Translator API unavailable');
  translator ??= t.create(PAIR).catch((e: unknown) => {
    translator = null; // a refused or failed download is tried again on the next gesture
    throw e;
  });
  const out = (await (await translator).translate(text)).trim();
  if (!out) throw new Error('empty translation');
  remember(text, out);
  return out;
}
