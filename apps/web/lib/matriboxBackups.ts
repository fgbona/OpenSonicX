import type { MbBackup } from './matribox.ts';

const KEY = 'pocket-master-editor.matribox-backups.v1';
const KEEP = 20;

/** Adds a backup in front and keeps the newest 20. */
export const keepMbBackup = (list: readonly MbBackup[], backup: MbBackup): MbBackup[] => [backup, ...list].slice(0, KEEP);

export function mbBackupFileName(backup: MbBackup): string {
  return `matribox-backup-${backup.label}-${backup.createdAt.replace(/:/g, '-').replace(/\..*$/, '')}.json`;
}

/** Matribox slot backups kept in this browser, newest first; [] when storage is missing or damaged. */
export function loadMbBackups(): MbBackup[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((b): b is MbBackup => typeof b?.label === 'string' && typeof b?.preset === 'string') : [];
  } catch (error) {
    console.error('could not read the stored Matribox backups', error);
    return [];
  }
}

/** Stores the list; false when the browser would not keep it (the caller offers the download). */
export function storeMbBackups(list: readonly MbBackup[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (error) {
    console.error('could not store the Matribox backup in this browser', error);
    return false;
  }
}
