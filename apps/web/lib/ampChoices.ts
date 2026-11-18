import { modelsFor } from '@pocket-master/core';

const LOW_24_BITS = 0xffffff;

export interface ProfileChoice {
  /** 1-based slot number, as on the pedal. */
  readonly slot: number;
  readonly name: string;
  /** Catalog code used to select the profile (the pedal reports it with category 0x0F). */
  readonly code: number;
}

/** Captured profiles the AMP block can use: occupied slots only, named as on the pedal. */
export function profileChoices(profileNames: readonly (string | null)[] | null): ProfileChoice[] {
  if (!profileNames) return [];
  return modelsFor('clone').flatMap((model, i) => {
    const name = profileNames[i];
    return name ? [{ slot: i + 1, name, code: model.code }] : [];
  });
}

/** Option value for the AMP select; a captured profile matches the catalog by its low 24 bits. */
export function modelValue(code: number, clone: boolean): string {
  if (!clone) return `amp:${code.toString(16)}`;
  const catalog = modelsFor('clone').find((m) => (m.code & LOW_24_BITS) === (code & LOW_24_BITS));
  return `clone:${(catalog?.code ?? code).toString(16)}`;
}

export function parseModelValue(value: string): { code: number; clone: boolean } | null {
  const match = /^(amp|clone):([0-9a-f]+)$/.exec(value);
  return match ? { code: parseInt(match[2]!, 16), clone: match[1] === 'clone' } : null;
}
