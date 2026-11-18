import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, parseFrame, crc8 } from '../src/frame.ts';
import { toHex, fromHex } from '../src/hex.ts';

// Captured from a real Pocket Master, firmware V1.3.3, 2026-11-18.
const TX_CURRENT_PRESET = 'F0 00 07 00 01 00 00 00 02 01 02 04 03 F7';
const TX_EDIT_BUFFER = 'F0 00 09 00 01 00 00 00 02 01 02 04 01 F7';
const RX_CURRENT_PRESET = 'F0 04 0B 00 01 00 00 00 04 01 02 04 03 00 07 00 00 F7';

test('crc8 is CRC-8/SMBus', () => {
  assert.equal(crc8([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]), 0xf4);
});

test('buildFrame matches captured queries', () => {
  assert.equal(toHex(buildFrame([0x12, 0x43])), TX_CURRENT_PRESET);
  assert.equal(toHex(buildFrame([0x12, 0x41])), TX_EDIT_BUFFER);
});

test('buildFrame rejects payloads over 255 bytes', () => {
  assert.throws(() => buildFrame(new Array(256).fill(0)), /too long/);
});

test('parseFrame decodes a captured reply', () => {
  const f = parseFrame(fromHex(RX_CURRENT_PRESET));
  assert.equal(f.crcOk, true);
  assert.equal(f.total, 1);
  assert.equal(f.index, 0);
  assert.equal(toHex(f.payload), '12 43 07 00');
});

test('parseFrame flags bad crc', () => {
  const bytes = fromHex(RX_CURRENT_PRESET);
  bytes[13] = 0x01; // payload nibble 07 -> 17
  assert.equal(parseFrame(bytes).crcOk, false);
});

test('parseFrame rejects bytes that are not a nibble-expanded SysEx frame', () => {
  assert.throws(() => parseFrame(fromHex('F0 00 7F 00 01 F7')), /nibble/);
  assert.throws(() => parseFrame(fromHex('00 07 00 01')), /F0/);
  assert.throws(() => parseFrame(fromHex('F0 00 07 F7')), /short/);
});

test('fromHex rejects odd input', () => {
  assert.throws(() => fromHex('F0 0'), /hex/);
});
