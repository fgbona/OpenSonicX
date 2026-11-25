import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mbPresetBody, parseMbPreset, toHex } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import {
  findTone,
  mbLibraryFile,
  mbTone,
  mergedTones,
  NOT_MB_LIBRARY,
  parseMbLibrary,
  parseMbLibraryFile,
  renamedTone,
  tonePreset,
  withoutTone,
  withTone,
  type MbTone,
} from '../lib/matriboxLibrary.ts';
import { localList } from '../lib/localList.ts';
import { LIBRARY_LIMIT } from '../lib/presetLibrary.ts';

const driveAd = () => parseMbPreset(new FakeMatribox().editBuffer);
const tone = (name: string, createdAt = `2026-11-25T00:00:${String(name.length).padStart(2, '0')}.000Z`, notes = '') => mbTone(driveAd(), name, notes, createdAt);
const names = (list: readonly MbTone[]) => list.map((t) => t.name);

test('a kept tone holds the whole preset and loads back as the same preset', () => {
  const kept = mbTone(driveAd(), ' Crunch ', ' AC/DC, Back in Black ', '2026-11-25T10:00:00.000Z');
  assert.equal(kept.name, 'Crunch');
  assert.equal(kept.notes, 'AC/DC, Back in Black');
  const back = tonePreset(kept);
  assert.equal(back.name, 'Drive AD');
  assert.equal(toHex(mbPresetBody(back)), toHex(mbPresetBody(driveAd())));
  assert.deepEqual(back.chain, driveAd().chain);
});

test('a tone goes first, a tone of the same name (any case) is replaced, and the library stops at its limit', () => {
  const list = withTone(withTone([], tone('A', 'a1')), tone('B', 'b1'));
  assert.deepEqual(names(list), ['B', 'A']);
  const again = withTone(list, tone('a', 'a2'));
  assert.deepEqual(names(again), ['a', 'B']);
  assert.equal(findTone(again, 'A')?.createdAt, 'a2');
  const full = Array.from({ length: LIBRARY_LIMIT + 3 }, (_, i) => tone(`T${i}`, `t${i}`)).reduce(withTone, [] as MbTone[]);
  assert.equal(full.length, LIBRARY_LIMIT);
  assert.equal(full[0]!.name, `T${LIBRARY_LIMIT + 2}`);
});

test('delete and rename act on one tone, by when it was kept; a rename onto another name replaces that one', () => {
  const list = [tone('A', 'a'), tone('B', 'b'), tone('C', 'c')];
  assert.deepEqual(names(withoutTone(list, 'b')), ['A', 'C']);
  assert.deepEqual(names(renamedTone(list, 'b', ' Lead ')), ['A', 'Lead', 'C']);
  assert.deepEqual(names(renamedTone(list, 'b', 'c')), ['A', 'c']);
  assert.deepEqual(names(renamedTone(list, 'b', '  ')), ['A', 'B', 'C']); // an empty name is refused
  assert.deepEqual(names(renamedTone(list, 'x', 'Z')), ['A', 'B', 'C']);
  assert.deepEqual(names(list), ['A', 'B', 'C']); // the list itself is left as it was
});

test('the stored library is read defensively: damaged entries are dropped, the rest kept', () => {
  assert.deepEqual(parseMbLibrary(null), []);
  assert.deepEqual(parseMbLibrary('not json'), []);
  assert.deepEqual(parseMbLibrary('{"a":1}'), []);
  const good = tone('Good');
  const raw = JSON.stringify([good, { ...good, name: 'Short', preset: 'abcd' }, { ...good, device: 'Pocket Master' }, { ...good, name: '' }, null, { ...good, name: 'No notes', notes: 3 }]);
  const list = parseMbLibrary(raw);
  assert.deepEqual(names(list), ['Good', 'No notes']);
  assert.equal(list[1]!.notes, '');
});

test('a library file round-trips, is merged with the file newest on top, and anything else is refused', () => {
  const mine = [tone('Mine', 'm'), tone('Shared', 's-old')];
  const file = JSON.stringify(mbLibraryFile([tone('New', 'n'), tone('Shared', 's-new')]));
  const incoming = parseMbLibraryFile(file);
  assert.deepEqual(names(incoming), ['New', 'Shared']);
  const merged = mergedTones(mine, incoming);
  assert.deepEqual(names(merged), ['New', 'Shared', 'Mine']);
  assert.equal(findTone(merged, 'shared')?.createdAt, 's-new');
  for (const bad of ['not json', '[]', '{"format":"pocket-master-backup","tones":[]}', JSON.stringify({ format: 'matribox-library', tones: 'x' })]) {
    assert.throws(() => parseMbLibraryFile(bad), new RegExp(NOT_MB_LIBRARY));
  }
});

test('the tone list reads and writes its own key, and lasts for the page when storage throws', () => {
  const stored = new Map<string, string>([['k', JSON.stringify([tone('Kept')])]]);
  const ok = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const use = (storage: object) => Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    use(ok);
    const list = localList('k', parseMbLibrary);
    assert.deepEqual(names(list.now()), ['Kept']);
    list.set(withTone(list.now(), tone('More')));
    assert.deepEqual(names(parseMbLibrary(stored.get('k') ?? null)), ['More', 'Kept']);
    use(blocked);
    const page = localList('k', parseMbLibrary);
    assert.deepEqual(page.now(), []);
    assert.doesNotThrow(() => page.set([tone('Only here')]));
    assert.deepEqual(names(page.now()), ['Only here']);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
