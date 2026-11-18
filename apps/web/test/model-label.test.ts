import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLabel } from '../lib/modelLabel.ts';

const irs = ['Marshal 80', null, 'Marshall W', 'Holy Grail', 'V30UK Md 4'];

test('user IR slots show the name of the loaded IR file', () => {
  assert.equal(modelLabel('ir', 0x0a100000, 'User IR 1', irs), 'Marshal 80 (User IR 1)');
  assert.equal(modelLabel('ir', 0x0a100004, 'User IR 5', irs), 'V30UK Md 4 (User IR 5)');
});

test('an empty slot, unknown names, factory cabinets and other blocks keep the catalog name', () => {
  assert.equal(modelLabel('ir', 0x0a100001, 'User IR 2', irs), 'User IR 2');
  assert.equal(modelLabel('ir', 0x0a100000, 'User IR 1', null), 'User IR 1');
  assert.equal(modelLabel('ir', 0x0a000022, 'BritGN 4x12', irs), 'BritGN 4x12');
  assert.equal(modelLabel('drv', 0x0a100000, 'Scream', irs), 'Scream');
});
