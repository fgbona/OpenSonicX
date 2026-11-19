import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame } from '../src/frame.ts';
import { toHex } from '../src/hex.ts';
import { decodeGlobals, factoryReset, setExpFsTarget, setGlobal } from '../src/globals.ts';

// Frames the official app sent, as captured by SonicMaster (MIT); 8080 USB prefix dropped.
const hex = (b: Uint8Array) => toHex(b).replace(/\s/g, '').toLowerCase();

test('global writes match the captured frames byte for byte', () => {
  assert.equal(hex(setGlobal('inputLevel', 20)), 'f0010e00010000000a0101010100010003000000000104000000000000f7');
  assert.equal(hex(setGlobal('inputLevel', -1)), 'f00f0f00010000000a0101010100010003000000000f0f0f0f0f0f0f0ff7');
  assert.equal(hex(setGlobal('masterVolume', 100)), 'f00c0600010000000a0101010100020002000000000604000000000000f7');
  assert.equal(hex(setGlobal('mode', 1)), 'f0070b00010000000a0101010100040004000000000001000000000000f7');
  assert.equal(hex(setGlobal('expFsType', 2)), 'f00c0100010000000a0101010100010005000000000002000000000000f7');
  assert.equal(hex(setGlobal('backlight', 10)), 'f0040400010000000a010101010003000200000000000a000000000000f7');
  assert.equal(hex(setGlobal('battOnly', 1)), 'f0090100010000000a0101010100060002000000000001000000000000f7');
  assert.equal(hex(setExpFsTarget('exp', 1)), 'f008070001000000040101010700010001f7');
  assert.equal(hex(factoryReset()), 'f0040b0001000000020101030ff7');
});

test('global writes refuse values out of range', () => {
  assert.throws(() => setGlobal('inputLevel', 21), /-20\.\.20/);
  assert.throws(() => setGlobal('masterVolume', 1.5), /0\.\.100/);
  // The unit reports 100 (owner's pedal, 2026-11-19), so the range is 0..100, not SonicMaster's 0..10.
  assert.doesNotThrow(() => setGlobal('backlight', 100));
  assert.throws(() => setGlobal('backlight', 101), /0\.\.100/);
  assert.throws(() => setExpFsTarget('fs', 18), /0\.\.17/);
  assert.throws(() => setExpFsTarget('exp', 8), /0\.\.7/);
});

test('the globals dump decodes at the offsets SonicMaster bound', () => {
  const p = new Array(81).fill(0);
  p[0] = 0x12; p[1] = 0x10;
  p[22] = 80; p[35] = 6; p[40] = 0xfb; p[45] = 3; p[50] = 0; p[60] = 1; p[65] = 0xec; p[70] = 1; p[75] = 0; p[80] = 2;
  assert.deepEqual(decodeGlobals(Uint8Array.from(p)), {
    masterVolume: 80, backlight: 6, inputLevel: -5, fxRecLevel: 3, monitorLevel: 0, mode: 1, btRecLevel: -20,
    reamp: 1, eco: 0, expFsType: 2,
  });
  // A short dump keeps the levels, and the later settings are unknown (null).
  const short = decodeGlobals(Uint8Array.from(p.slice(0, 66)));
  assert.equal(short?.btRecLevel, -20);
  assert.equal(short?.expFsType, null);
  assert.equal(decodeGlobals(Uint8Array.from(p.slice(0, 40))), null);
  assert.equal(decodeGlobals(Uint8Array.from([0x12, 0x41, ...p.slice(2)])), null);
  assert.equal(buildFrame([0x12, 0x10]).length > 0, true);
});
