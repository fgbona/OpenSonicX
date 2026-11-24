import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/catalog.ts';

test('no model offers Sync or Trail: the V1.3.3 firmware writes those slots into the first parameter', () => {
  const offending = Object.values(catalog.models)
    .flat()
    .flatMap((m) => m.params.filter((p) => p.name === 'Sync' || p.name === 'Trail').map((p) => `${m.name}.${p.name}`));
  assert.deepEqual(offending, []);
});
