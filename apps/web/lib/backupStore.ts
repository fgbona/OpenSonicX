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

/** Adds a backup and returns the new list. Keeps the last 3 session and 20 slot backups. */
export function storeBackup(list: readonly BackupFile[], file: BackupFile): BackupFile[] {
  const next = [file, ...list];
  const sessions = next.filter((b) => b.kind === 'session').slice(0, KEEP_SESSIONS);
  const slots = next.filter((b) => b.kind === 'slot').slice(0, KEEP_SLOTS);
  const kept = next.filter((b) => sessions.includes(b) || slots.includes(b));
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch (error) {
    // The downloaded file is the primary copy; storage is a convenience.
    console.error('could not store the backup in this browser', error);
  }
  return kept;
}

export function backupFileName(file: BackupFile): string {
  const stamp = file.createdAt.replace(/[:]/g, '-').replace(/\..*$/, '');
  const what = file.kind === 'session' ? 'all-user-presets' : `${file.slots[0]?.label ?? 'slot'}`;
  return `pocket-master-backup-${what}-${stamp}.json`;
}

/** Hands the visitor the backup as a file. */
export function downloadBackup(file: BackupFile): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(file);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
