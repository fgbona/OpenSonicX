import { parseBackupFile, type BackupFile } from '@pocket-master/core';

const KEY = 'pocket-master-editor.backups.v1';
const KEEP_SESSIONS = 3;
const KEEP_SLOTS = 20;

/** Backups kept in this browser, newest first. Storage can be missing or full; callers get [] then. */
export function loadBackups(): BackupFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown[];
    return list.flatMap((item) => {
      try {
        return [parseBackupFile(JSON.stringify(item))];
      } catch {
        return []; // skip a damaged entry, keep the rest
      }
    });
  } catch (error) {
    console.error('could not read stored backups', error);
    return [];
  }
}

/**
 * Adds a backup (once) and returns the new list and whether the browser kept it.
 * Keeps the last 3 session and 20 slot backups.
 */
export function storeBackup(list: readonly BackupFile[], file: BackupFile): { list: BackupFile[]; stored: boolean } {
  const same = (b: BackupFile) => b.kind === file.kind && b.createdAt === file.createdAt;
  const next = [file, ...list.filter((b) => !same(b))];
  const sessions = next.filter((b) => b.kind === 'session').slice(0, KEEP_SESSIONS);
  const slots = next.filter((b) => b.kind === 'slot').slice(0, KEEP_SLOTS);
  const kept = next.filter((b) => sessions.includes(b) || slots.includes(b));
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
    return { list: kept, stored: true };
  } catch (error) {
    console.error('could not store the backup in this browser', error);
    return { list: kept, stored: false };
  }
}

/** Removes a backup and returns the new list and whether the browser kept the change. */
export function removeBackup(list: readonly BackupFile[], file: BackupFile): { list: BackupFile[]; stored: boolean } {
  const kept = list.filter((b) => !(b.kind === file.kind && b.createdAt === file.createdAt));
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
    return { list: kept, stored: true };
  } catch (error) {
    console.error('could not update the stored backups', error);
    return { list: kept, stored: false };
  }
}

export function backupFileName(file: BackupFile): string {
  const stamp = file.createdAt.replace(/[:]/g, '-').replace(/\..*$/, '');
  const what = file.kind === 'session' ? 'all-user-presets' : `${file.slots[0]?.label ?? 'slot'}`;
  return `pocket-master-backup-${what}-${stamp}.json`;
}

/** Hands the visitor a JSON file. Call it from a click: Chrome blocks repeated downloads without one. */
export function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadBackup(file: BackupFile): void {
  downloadJson(file, backupFileName(file));
}
