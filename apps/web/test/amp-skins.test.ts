import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelsFor } from '@pocket-master/core';
import { ampSkin, hasTube } from '../lib/ampSkins.ts';

test('every catalog amp model has a faceplate finish; profiles and unknown names keep the plain one', () => {
  assert.deepEqual(modelsFor('amp').filter((m) => ampSkin(m.name) === null).map((m) => m.name), []);
  assert.equal(ampSkin('Brit 800'), 'marshall');
  assert.equal(ampSkin('Calif DualM'), 'mesa');
  assert.equal(ampSkin('Randall SA'), null);
  assert.equal(ampSkin(undefined), null);
});

test('only the solid-state Jazz 120 has no tube', () => {
  assert.equal(hasTube(ampSkin('Jazz 120')), false);
  assert.equal(modelsFor('amp').filter((m) => !hasTube(ampSkin(m.name))).length, 1);
  assert.equal(hasTube(null), true);
});
