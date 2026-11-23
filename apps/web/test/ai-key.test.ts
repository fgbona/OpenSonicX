import { test } from 'node:test';
import assert from 'node:assert/strict';

/** A Storage stand-in, enough for aiKey.ts. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) { return this.items.get(k) ?? null; }
  setItem(k: string, v: string) { this.items.set(k, String(v)); }
  removeItem(k: string) { this.items.delete(k); }
}
const local = new MemoryStorage();
const session = new MemoryStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session });
const { forgetKeys, loadKey, loadPaid, loadRemember, saveKey, savePaid, saveRemember } = await import('../lib/aiKey.ts');
const isPaid = () => true;

test('keys are remembered on this device by default', () => {
  assert.equal(loadRemember(), true);
  saveKey('groq', 'gsk_one');
  assert.equal(local.getItem('pocket-master-editor.groqKey.v1'), 'gsk_one');
  assert.equal(loadKey('groq'), 'gsk_one');
});

test('not remembering moves the keys to this session only, and back when turned on again', () => {
  savePaid([{ id: 'openai', key: 'sk-two', model: 'gpt' }]);
  saveRemember(false);
  assert.equal(loadRemember(), false);
  assert.equal(local.getItem('pocket-master-editor.groqKey.v1'), null, 'nothing left for the next person on this browser');
  assert.equal(local.getItem('pocket-master-editor.aiProviders.v1'), null);
  assert.equal(loadKey('groq'), 'gsk_one');
  assert.deepEqual(loadPaid(isPaid).map((e) => e.key), ['sk-two']);
  saveKey('gemini', 'AIza-three');
  assert.equal(session.getItem('pocket-master-editor.geminiKey.v1'), 'AIza-three');
  assert.equal(local.getItem('pocket-master-editor.geminiKey.v1'), null);
  saveRemember(true);
  assert.equal(local.getItem('pocket-master-editor.geminiKey.v1'), 'AIza-three');
  assert.equal(session.getItem('pocket-master-editor.geminiKey.v1'), null);
});

test('forgetting removes every key from both places', () => {
  forgetKeys();
  assert.equal(loadKey('groq'), null);
  assert.equal(loadKey('gemini'), null);
  assert.deepEqual(loadPaid(isPaid), []);
  assert.equal([...local.items.keys(), ...session.items.keys()].filter((k) => /Key|Providers/.test(k)).length, 0);
});
