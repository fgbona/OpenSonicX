'use client';

/**
 * The person's AI keys (Groq, Gemini), kept only on this device (localStorage) and sent only to
 * their provider. They are never logged or shown back in full.
 */
import type { Provider } from './assistant.ts';

const KEYS: Readonly<Record<Provider, string>> = {
  gemini: 'pocket-master-editor.geminiKey.v1',
  groq: 'pocket-master-editor.groqKey.v1',
};

export function loadKey(provider: Provider): string | null {
  try {
    return localStorage.getItem(KEYS[provider]);
  } catch {
    return null;
  }
}

/** False when the browser would not keep it (storage blocked); the key then lasts for this page. */
export function saveKey(provider: Provider, key: string): boolean {
  try {
    localStorage.setItem(KEYS[provider], key.trim());
    return true;
  } catch {
    return false;
  }
}

export function removeKey(provider: Provider): void {
  try {
    localStorage.removeItem(KEYS[provider]);
  } catch {
    // nothing stored
  }
}

/** "AIza…stuv": enough to recognise a key, not to use it. */
export function maskKey(key: string): string {
  return key.length < 12 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}
