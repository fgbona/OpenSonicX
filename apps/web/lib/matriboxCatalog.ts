/**
 * The Matribox model catalog: the official editor's alg_data.json, which is Sonicake's. It is never
 * bundled or fetched from the internet. In a browser the owner picks his own copy once and it stays
 * in this browser (IndexedDB); the desktop app serves it from the official app's install
 * (apps/desktop, /matribox-catalog.json on its own app:// origin).
 */
import { parseMbCatalog, type MbCatalog } from '@pocket-master/core';

export const MAC_CATALOG_PATH = '/Applications/Matribox II PRO.app/Contents/Frameworks/App.framework/Resources/flutter_assets/assets/alg/alg_data.json';
/** Where the desktop app serves the installed catalog. */
export const DESKTOP_CATALOG_URL = '/matribox-catalog.json';

const DB = 'pocket-master-editor';
const STORE = 'matribox';
const KEY = 'alg_data.json';

export function parseCatalogText(text: string): MbCatalog {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not an alg_data.json (it is not JSON).');
  }
  try {
    return parseMbCatalog(json);
  } catch (error) {
    throw new Error(`This file is not an alg_data.json: ${(error as Error).message}`);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** The catalog text kept in this browser, null when none was picked (or storage is blocked). */
export async function loadStoredCatalog(): Promise<string | null> {
  try {
    const text = await withStore<unknown>('readonly', (s) => s.get(KEY));
    return typeof text === 'string' ? text : null;
  } catch (error) {
    console.error('could not read the stored Matribox catalog', error);
    return null;
  }
}

export async function storeCatalog(text: string): Promise<void> {
  await withStore('readwrite', (s) => s.put(text, KEY));
}

export async function forgetCatalog(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY));
}

/** Desktop app only: the catalog of the installed official app, null when it is not installed. */
export async function loadDesktopCatalog(): Promise<string | null> {
  try {
    const response = await fetch(DESKTOP_CATALOG_URL);
    return response.ok ? await response.text() : null;
  } catch (error) {
    console.warn('the desktop app did not serve the Matribox catalog', error);
    return null;
  }
}
