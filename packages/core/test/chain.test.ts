import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainUnits, moveInChain } from '../src/chain.ts';

const P08 = [0, 1, 2, 3, 4, 5, 6, 7, 8];

test('chainUnits groups DRV-AMP-IR-EQ as one unit', () => {
  assert.deepEqual(chainUnits(P08), [[0], [1], [2, 3, 4, 5], [6], [7], [8]]);
  assert.deepEqual(chainUnits([2, 3, 4, 5, 0, 7, 8, 1, 6]), [[2, 3, 4, 5], [0], [7], [8], [1], [6]]);
});

test('moveInChain moves a single block to a unit position', () => {
  assert.deepEqual(moveInChain(P08, 8, 0), [8, 0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(moveInChain(P08, 0, 5), [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.deepEqual(moveInChain(P08, 6, 1), [0, 6, 1, 2, 3, 4, 5, 7, 8]);
});

test('moveInChain moves the whole group when any of its blocks is moved', () => {
  assert.deepEqual(moveInChain(P08, 3, 0), [2, 3, 4, 5, 0, 1, 6, 7, 8]);
  assert.deepEqual(moveInChain(P08, 5, 5), [0, 1, 6, 7, 8, 2, 3, 4, 5]);
});

test('moveInChain clamps the position and returns a new array', () => {
  const order = [...P08];
  assert.deepEqual(moveInChain(order, 0, 99), [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.deepEqual(moveInChain(order, 0, -3), P08);
  assert.deepEqual(order, P08);
});
