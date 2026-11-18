import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMessage } from '../src/describe.ts';
import { readCapture } from './capture.ts';

const c = readCapture('p08-capture.txt');

test('describeMessage labels queries, replies and packets', () => {
  assert.equal(describeMessage(c[0]!.bytes), 'get current preset');
  assert.equal(describeMessage(c[1]!.bytes), 'current preset');
  assert.equal(describeMessage(c[3]!.bytes), 'edit buffer, packet 1/26');
  assert.equal(describeMessage(c[4]!.bytes), 'packet 2/26');
});

test('describeMessage flags bad checksum and malformed data', () => {
  const bad = c[1]!.bytes.slice();
  bad[13] = 0x01;
  assert.equal(describeMessage(bad), 'bad checksum');
  assert.equal(describeMessage(Uint8Array.from([0xf0, 0x7f, 0xf7])), 'not a Pocket Master frame');
});
