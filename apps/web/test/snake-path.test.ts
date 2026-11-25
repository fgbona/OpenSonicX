import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snakePath, snakeRows, type TileBox } from '../lib/snakePath.ts';

const tile = (col: number, row: number): TileBox => ({ left: 20 + col * 100, right: 100 + col * 100, top: row * 140, bottom: 100 + row * 140, mid: 50 + row * 140 });

test('tiles group into the rows they wrapped onto', () => {
  const tiles = [tile(0, 0), tile(1, 0), tile(2, 0), tile(0, 1), tile(1, 1)];
  assert.deepEqual(
    snakeRows(tiles).map((r) => r.length),
    [3, 2],
  );
  assert.deepEqual(snakeRows([]), []);
});

test('one row is a straight line to the last tile', () => {
  assert.equal(snakePath([tile(0, 0), tile(1, 0)]), 'M20 50 H120');
  assert.equal(snakePath([]), '');
});

test('a row end bends down past the right edge, runs back in the gap, and enters the next row from the left', () => {
  const path = snakePath([tile(0, 0), tile(1, 0), tile(0, 1)]);
  // Right bend at 200 + 8, gap between bottoms (100) and next tops (140) at 120, left bend at 20 - 8.
  assert.equal(path, 'M20 50 H196 A12 12 0 0 1 208 62 V108 A12 12 0 0 1 196 120 H24 A12 12 0 0 0 12 132 V178 A12 12 0 0 0 24 190');
  assert.match(snakePath([tile(0, 0), tile(0, 1), tile(1, 1)]), / A12 12 0 0 0 24 190 H120$/);
});
