import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
}
const local = new MemoryStorage();
Object.assign(globalThis, { localStorage: local });
const { cachedTranslation, resetTranslator, textKey, translateSupport, translateToPt } = await import('../lib/translate.ts');

type Stub = { availability: () => Promise<string>; create: () => Promise<{ translate: (t: string) => Promise<string> }> };
const install = (stub: Stub | undefined) => Object.assign(globalThis, { Translator: stub });
const working = (calls: string[] = []): Stub => ({
  availability: async () => 'available',
  create: async () => ({
    translate: async (t) => {
      calls.push(t);
      return `PT:${t}`;
    },
  }),
});

beforeEach(() => {
  local.items.clear();
  resetTranslator();
  install(undefined);
});

test('translates, then answers from the cache without asking the model again', async () => {
  const calls: string[] = [];
  install(working(calls));
  assert.equal(await translateSupport(), 'ready');
  assert.equal(await translateToPt('invented text'), 'PT:invented text');
  assert.equal(await translateToPt('invented text'), 'PT:invented text');
  assert.deepEqual(calls, ['invented text']);
  assert.equal(cachedTranslation('invented text'), 'PT:invented text');
  assert.match([...local.items.keys()][0] ?? '', /\.v1$/);
  assert.ok(textKey('a') !== textKey('b'));
});

test('a cache hit works even when the API is gone', async () => {
  install(working());
  await translateToPt('invented text');
  install(undefined);
  assert.equal(await translateToPt('invented text'), 'PT:invented text');
});

test('unavailable: no API, an unsupported pair, a throwing availability; a download is flagged', async () => {
  assert.equal(await translateSupport(), 'none');
  install({ ...working(), availability: async () => 'unavailable' });
  assert.equal(await translateSupport(), 'none');
  install({
    ...working(),
    availability: async () => {
      throw new Error('x');
    },
  });
  assert.equal(await translateSupport(), 'none');
  install({ ...working(), availability: async () => 'downloadable' });
  assert.equal(await translateSupport(), 'download');
});

test('an availability that never answers counts as unavailable', async () => {
  install({ ...working(), availability: () => new Promise(() => {}) });
  assert.equal(await translateSupport(), 'none');
});

test('an error while translating rejects, caches nothing, and is retried', async () => {
  let fail = true;
  install({
    availability: async () => 'available',
    create: async () => ({
      translate: async (t) => {
        if (fail) throw new Error('boom');
        return `PT:${t}`;
      },
    }),
  });
  await assert.rejects(translateToPt('invented text'));
  assert.equal(cachedTranslation('invented text'), null);
  fail = false;
  assert.equal(await translateToPt('invented text'), 'PT:invented text');
});

test('a failed create is not remembered', async () => {
  let n = 0;
  install({
    availability: async () => 'downloadable',
    create: async () => {
      if (n++ === 0) throw new Error('no gesture');
      return { translate: async (t) => `PT:${t}` };
    },
  });
  await assert.rejects(translateToPt('x text'));
  assert.equal(await translateToPt('x text'), 'PT:x text');
});
