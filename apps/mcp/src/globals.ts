import { EXP_TARGETS, FS_TARGETS, GLOBAL_SETTINGS, setExpFsTarget, setGlobal, type GlobalSetting, type GlobalSettings } from '@pocket-master/core';

/** What set_global_settings takes: setting values, plus targets by name. */
export type GlobalChanges = Partial<Record<GlobalSetting, number>> & {
  expTarget?: string;
  fsTarget?: string;
  fs1Target?: string;
  fs2Target?: string;
};

const JACK = ['expression pedal', 'single footswitch', 'dual footswitch'] as const;
const TARGET_FOR_TYPE = { expTarget: 0, fsTarget: 1, fs1Target: 2, fs2Target: 2 } as const;
const TARGET_SLOT = { expTarget: 'exp', fsTarget: 'fs', fs1Target: 'fs1', fs2Target: 'fs2' } as const;
const LABEL: Record<GlobalSetting, string> = {
  masterVolume: 'Master volume', inputLevel: 'Input level', fxRecLevel: 'FX rec level', monitorLevel: 'Monitor level',
  btRecLevel: 'BT rec level', mode: 'USB recording', reamp: 'Re-amp', expFsType: 'EXP/FS jack', backlight: 'Backlight',
  eco: 'ECO', powerConfirm: 'Power-off confirm', battOnly: 'Battery only',
};

const db = (v: number) => `${v} dB`;
const onOff = (v: number | null) => (v === null ? 'unknown' : v ? 'on' : 'off');

export function describeGlobals(g: GlobalSettings): string {
  return [
    `Master volume ${g.masterVolume}`,
    `Levels: Input ${db(g.inputLevel)}, FX rec ${db(g.fxRecLevel)}, Monitor ${db(g.monitorLevel)}, BT rec ${db(g.btRecLevel)}`,
    `USB recording: ${g.mode === null ? 'unknown' : g.mode ? 'wet' : 'dry'}; re-amp ${onOff(g.reamp)}`,
    `EXP/FS jack: ${g.expFsType === null ? 'unknown' : JACK[g.expFsType] ?? `type ${g.expFsType}`}`,
    `Backlight ${g.backlight ?? 'unknown'}; ECO ${onOff(g.eco)}`,
    'Not reported by the pedal: EXP/FS targets, power-off confirm, battery only.',
  ].join('\n');
}

/**
 * Validates every change, then returns the write commands (jack type before its targets) and a
 * summary. Throws before anything is built when one value is wrong.
 */
export function globalWrites(changes: GlobalChanges, current: GlobalSettings): { bytes: Uint8Array[]; summary: string[] } {
  const bytes: Uint8Array[] = [];
  const summary: string[] = [];
  const settings = (Object.keys(GLOBAL_SETTINGS) as GlobalSetting[]).filter((k) => changes[k] !== undefined);
  const ordered = [...settings.filter((k) => k === 'expFsType'), ...settings.filter((k) => k !== 'expFsType')];
  for (const key of ordered) {
    const value = changes[key] as number;
    bytes.push(setGlobal(key, value));
    summary.push(`${LABEL[key]} ${key.endsWith('Level') ? db(value) : value}`);
  }
  const type = changes.expFsType ?? current.expFsType;
  for (const key of Object.keys(TARGET_FOR_TYPE) as (keyof typeof TARGET_FOR_TYPE)[]) {
    const name = changes[key];
    if (name === undefined) continue;
    if (type !== TARGET_FOR_TYPE[key]) {
      throw new Error(`${key} needs the jack set to ${JACK[TARGET_FOR_TYPE[key]]}; the EXP/FS jack is set to ${type === null ? 'an unknown type' : JACK[type]} (change expFsType in the same call).`);
    }
    const names: readonly string[] = key === 'expTarget' ? EXP_TARGETS : FS_TARGETS;
    const index = names.findIndex((n) => n.toLowerCase() === name.trim().toLowerCase());
    if (index < 0) throw new Error(`${key} options: ${names.join(', ')}`);
    bytes.push(setExpFsTarget(TARGET_SLOT[key], index));
    summary.push(`${key} ${names[index]}`);
  }
  if (bytes.length === 0) throw new Error('Nothing to change: give at least one setting.');
  return { bytes, summary };
}
