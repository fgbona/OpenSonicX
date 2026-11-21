'use client';

/**
 * The person's Gemini API key, kept only on this device (localStorage) and sent only to Google.
 * It is never logged or shown back in full.
 */
const KEY = 'pocket-master-editor.geminiKey.v1';

export function loadKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** False when the browser would not keep it (storage blocked); the key then lasts for this page. */
export function saveKey(key: string): boolean {
  try {
    localStorage.setItem(KEY, key.trim());
    return true;
  } catch {
    return false;
  }
}

export function removeKey(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** "AIza…stuv": enough to recognise a key, not to use it. */
export function maskKey(key: string): string {
  return key.length < 12 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}
