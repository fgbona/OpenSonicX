import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePresetFile, type PresetFile } from '@pocket-master/core';
import { LIBRARY_LIMIT, parseLibrary, withoutPreset, withPreset } from '../lib/presetLibrary.ts';

const V1 = readFileSync(new URL('../../../packages/core/test/fixtures/preset-files/v1-iron-lead.json', import.meta.url), 'utf8');
const iron = parsePresetFile(V1);
const named = (name: string, createdAt = iron.createdAt): PresetFile => ({ ...iron, name, createdAt });

test('a preset goes first, and saving the same sound under the same name again only moves it up', () => {
  const list = withPreset(withPreset([], named('A')), named('B'));
  assert.deepEqual(list.map((f) => f.name), ['B', 'A']);
  assert.deepEqual(withPreset(list, named('A', '2026-11-22T00:00:00.000Z')).map((f) => f.name), ['A', 'B']);
});

test('the library keeps the newest presets up to its limit, and one can be removed', () => {
  const full = Array.from({ length: LIBRARY_LIMIT + 5 }, (_, i) => named(`P${i}`)).reduce(withPreset, [] as PresetFile[]);
  assert.equal(full.length, LIBRARY_LIMIT);
  assert.equal(full[0]!.name, `P${LIBRARY_LIMIT + 4}`);
  assert.deepEqual(withoutPreset([named('A'), named('B')], named('A')).map((f) => f.name), ['B']);
});

test('the stored library is read defensively: damaged entries are dropped, the rest kept', () => {
  assert.deepEqual(parseLibrary(null), []);
  assert.deepEqual(parseLibrary('not json'), []);
  assert.deepEqual(parseLibrary(JSON.stringify([JSON.parse(V1), { format: 'x' }])).map((f) => f.name), ['IRON-LEAD']);
});
