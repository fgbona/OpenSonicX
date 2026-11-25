/**
 * The AI connection's settings in the app's user data: whether it is on (off until the person
 * turns it on) and its bearer token, made on first enable. The file is readable by its owner only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newToken } from './ai-guard.ts';

export interface AiSettings {
  readonly enabled: boolean;
  readonly token: string | null;
}

export const OFF: AiSettings = { enabled: false, token: null };
const FILE = 'ai-connection.json';

/** The saved settings; off when there are none or the file is not ours to trust. */
export function loadAiSettings(dir: string): AiSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return OFF;
    const { enabled, token } = raw as Record<string, unknown>;
    const valid = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
    return { enabled: enabled === true && valid, token: valid ? token : null };
  } catch {
    return OFF; // no file yet, or unreadable: off
  }
}

export function saveAiSettings(dir: string, settings: AiSettings): void {
  writeFileSync(join(dir, FILE), JSON.stringify(settings), { mode: 0o600 });
}

/** Turned on: keeps the token it has, or makes the first one. */
export const enable = (s: AiSettings): AiSettings => ({ enabled: true, token: s.token ?? newToken() });
export const disable = (s: AiSettings): AiSettings => ({ ...s, enabled: false });
export const regenerate = (s: AiSettings): AiSettings => ({ ...s, token: newToken() });
