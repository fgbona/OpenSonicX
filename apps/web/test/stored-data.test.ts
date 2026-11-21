import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { BackupFile } from '@pocket-master/core';
import { loadBackups, storeBackup } from '../lib/backupStore.ts';
import { setSlotNote } from '../lib/slotNotes.ts';

// What 0.13 left in a browser's localStorage. Every 1.x must read it as it is: backups and slot
// comments live only there, so an update that changed a key or a shape would lose them silently.
const STORED: Record<string, string> = JSON.parse(readFileSync(new URL('./fixtures/storage-0.13.json', import.meta.url), 'utf8'));

function browser() {
  const items = new Map(Object.entries(STORED));
  globalThis.localStorage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  } as Storage;
  return items;
}

test('backups stored by 0.13 still load, and a new one is added next to them', () => {
  const items = browser();
  const old = loadBackups();
  assert.equal(old.length, 1);
  assert.deepEqual(old[0]!.slots.map((s) => `${s.label} ${s.name}`), ['P08 IRON-LEAD']);

  const added: BackupFile = { ...old[0]!, createdAt: '2026-11-22T10:00:00.000Z', slots: [{ ...old[0]!.slots[0]!, index: 1, label: 'P02', name: 'NEW' }] };
  assert.equal(storeBackup(old, added).stored, true);
  assert.deepEqual(JSON.parse(items.get('pocket-master-editor.backups.v1')!).map((b: BackupFile) => b.slots[0]!.label), ['P02', 'P08']);
});

test('slot comments stored by 0.13 survive writing a new one', () => {
  const items = browser();
  setSlotNote('ir', 1, 'Brutal Pri', 'Mesa 4x12');
  assert.deepEqual(JSON.parse(items.get('pocket-master-editor.slotNotes.v1')!), {
    'profile:0:Randall SA': 'Randall Satan, high gain',
    'ir:0:Marshal 80': 'Greenback 4x12',
    'ir:1:Brutal Pri': 'Mesa 4x12',
  });
});
