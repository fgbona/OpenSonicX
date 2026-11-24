import { setGlobal, TESTED_FIRMWARE, type GlobalSettings } from '@pocket-master/core';

/**
 * The device-wide settings a Pocket Master (firmware V1.3.3) has. The core also knows Smart Box
 * settings (USB mode, re-amp, ECO, battery only, EXP/FS jack and targets) that this pedal lacks.
 */
export const EDITABLE = ['masterVolume', 'inputLevel', 'fxRecLevel', 'monitorLevel', 'btRecLevel', 'backlight', 'bootProtection'] as const;
export type Editable = (typeof EDITABLE)[number];

/** What set_global_settings takes. */
export type GlobalChanges = Partial<Record<Editable, number>>;

const LABEL: Record<Editable, string> = {
  masterVolume: 'Master volume',
  inputLevel: 'Input level',
  fxRecLevel: 'FX rec level',
  monitorLevel: 'Monitor level',
  btRecLevel: 'BT rec level',
  backlight: 'Backlight',
  bootProtection: 'Boot anti-touch protection',
};

const db = (v: number) => `${v} dB`;
const onOff = (v: number) => (v ? 'on' : 'off');

export function describeGlobals(g: GlobalSettings): string {
  const shown = (label: string, value: number | null, text: (v: number) => string) => (value === null ? null : `${label} ${text(value)}`);
  const levels = [shown('Input', g.inputLevel, db), shown('FX rec', g.fxRecLevel, db), shown('Monitor', g.monitorLevel, db), shown('BT rec', g.btRecLevel, db)].filter((l) => l !== null);
  return [
    g.firmware ? `Firmware ${g.firmware}${g.firmware === TESTED_FIRMWARE ? '' : ` (this server was tested on ${TESTED_FIRMWARE}; other versions may behave differently)`}` : null,
    `Master volume ${g.masterVolume}`,
    levels.length > 0 ? `Levels: ${levels.join(', ')}` : null,
    shown('Backlight', g.backlight, String),
    shown('Boot anti-touch protection', g.bootProtection, onOff),
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Validates every change, then returns the write commands and a summary; throws before building any on a bad value. */
export function globalWrites(changes: GlobalChanges): { bytes: Uint8Array[]; summary: string[] } {
  const keys = EDITABLE.filter((k) => changes[k] !== undefined);
  if (keys.length === 0) throw new Error('Nothing to change: give at least one setting.');
  const bytes = keys.map((k) => setGlobal(k, changes[k] as number));
  const summary = keys.map((k) => `${LABEL[k]} ${k.endsWith('Level') ? db(changes[k] as number) : k === 'bootProtection' ? onOff(changes[k] as number) : changes[k]}`);
  return { bytes, summary };
}
