'use client';

/**
 * The person's AI keys, kept only in this browser and sent only to their provider. Remembered
 * (localStorage) by default; with Remember off they live in sessionStorage and go when the browser
 * closes, for a shared computer. They are never logged or shown back in full. The free ones (Groq, Gemini) keep their 1.x keys;
 * paid providers are one list with the model picked for each.
 */
import type { PaidId } from './assistant.ts';

type Provider = 'groq' | 'gemini';
const KEYS: Readonly<Record<Provider, string>> = {
  gemini: 'pocket-master-editor.geminiKey.v1',
  groq: 'pocket-master-editor.groqKey.v1',
};

const PAID_KEY = 'pocket-master-editor.aiProviders.v1';
const REMEMBER_KEY = 'pocket-master-editor.aiRemember.v1';
/** Every storage entry that holds a key. */
const SECRETS = [...Object.values(KEYS), PAID_KEY];

/** Whether keys stay in this browser after it closes (the default). */
export function loadRemember(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  } catch {
    return true;
  }
}

const keyStore = (): Storage => (loadRemember() ? localStorage : sessionStorage);

/** Moves the stored keys to where the new choice keeps them. */
export function saveRemember(on: boolean): void {
  try {
    const [from, to] = on ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
    for (const k of SECRETS) {
      const v = from.getItem(k);
      if (v !== null) to.setItem(k, v);
      from.removeItem(k);
    }
    if (on) localStorage.removeItem(REMEMBER_KEY);
    else localStorage.setItem(REMEMBER_KEY, 'false');
  } catch {
    // storage blocked: the keys already last only for this page
  }
}

/** Removes every key, remembered or not. */
export function forgetKeys(): void {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      SECRETS.forEach((k) => store().removeItem(k));
    } catch {
      // nothing stored there
    }
  }
}

export function loadKey(provider: Provider): string | null {
  try {
    return keyStore().getItem(KEYS[provider]);
  } catch {
    return null;
  }
}

/** False when the browser would not keep it (storage blocked); the key then lasts for this page. */
export function saveKey(provider: Provider, key: string): boolean {
  try {
    keyStore().setItem(KEYS[provider], key.trim());
    return true;
  } catch {
    return false;
  }
}

export function removeKey(provider: Provider): void {
  try {
    keyStore().removeItem(KEYS[provider]);
  } catch {
    // nothing stored
  }
}

/** "AIza…stuv": enough to recognise a key, not to use it. */
export function maskKey(key: string): string {
  return key.length < 12 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** A paid provider the person added: its key and the model they picked. */
export interface PaidEntry {
  readonly id: PaidId;
  readonly key: string;
  readonly model: string;
}

export function loadPaid(isPaid: (id: string) => boolean): PaidEntry[] {
  try {
    const list: unknown = JSON.parse(keyStore().getItem(PAID_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((e): e is PaidEntry => typeof e?.id === 'string' && isPaid(e.id) && typeof e.key === 'string' && typeof e.model === 'string');
  } catch {
    return [];
  }
}

/** False when the browser would not keep them (storage blocked); they then last for this page. */
export function savePaid(list: readonly PaidEntry[]): boolean {
  try {
    if (list.length === 0) keyStore().removeItem(PAID_KEY);
    else keyStore().setItem(PAID_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const ORDER_KEY = 'pocket-master-editor.aiOrder.v1';
const ROTATE_KEY = 'pocket-master-editor.aiRotate.v1';

/** The answer order the person set (model ids), oldest first; empty when never set. */
export function loadOrder(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

export function saveOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // the order then lasts for this page
  }
}

export function loadRotate(): boolean {
  try {
    return localStorage.getItem(ROTATE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveRotate(on: boolean): void {
  try {
    if (on) localStorage.setItem(ROTATE_KEY, 'true');
    else localStorage.removeItem(ROTATE_KEY);
  } catch {
    // the choice then lasts for this page
  }
}
