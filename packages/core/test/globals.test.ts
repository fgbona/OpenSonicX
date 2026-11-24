import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/hex.ts';
import { fromHex } from '../src/hex.ts';
import { decodeFirmware, decodeGlobals, factoryReset, setExpFsTarget, setGlobal, TESTED_FIRMWARE } from '../src/globals.ts';

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

// Reply to 12 10 from the owner's unit (firmware V1.3.3, 2026-11-20): records of
// <address a0 a1> <length u16 LE> <value>. Settings this firmware does not have are absent.
const OWNER_GLOBALS = fromHex(
  '12 10 01 01 04 00 03 03 01 01 02 01 04 00 02 00 00 00 02 02 04 00 3C 00 00 00 01 02 01 00 00 03 ' +
    '02 01 00 64 01 03 01 00 FB 01 04 01 00 00 02 04 01 00 00 03 04 01 00 01 04 04 01 00 01 05 04 01 ' +
    '00 EC 05 02 01 00 01',
);

test('the globals reply decodes by record address, not by byte position', () => {
  assert.deepEqual(decodeGlobals(OWNER_GLOBALS), {
    masterVolume: 60,
    backlight: 100,
    inputLevel: -5,
    fxRecLevel: 0,
    monitorLevel: 0,
    btRecLevel: -20,
    mode: 1,
    bootProtection: 1,
    reamp: null,
    eco: null,
    expFsType: null,
    firmware: 'V1.3.3',
  });
  assert.equal(decodeGlobals(Uint8Array.from([0x12, 0x41, ...OWNER_GLOBALS.slice(2)])), null);
  assert.equal(decodeGlobals(OWNER_GLOBALS.slice(0, 10)), null, 'no master volume record');
});

test('queued target writes keep only the latest value per slot; settings keep one per address', async () => {
  const { editKey } = await import('../src/commands.ts');
  assert.equal(editKey(setExpFsTarget('fs1', 2)), editKey(setExpFsTarget('fs1', 5)));
  assert.notEqual(editKey(setExpFsTarget('fs1', 2)), editKey(setExpFsTarget('fs2', 2)));
  assert.notEqual(editKey(setExpFsTarget('exp', 1)), editKey(setExpFsTarget('fs', 1)));
  assert.equal(editKey(setGlobal('inputLevel', 1)), editKey(setGlobal('inputLevel', -3)));
  assert.notEqual(editKey(setGlobal('inputLevel', 1)), editKey(setGlobal('fxRecLevel', 1)));
});

// Record 01 01 holds the firmware version, last part first (klotznick's interoperability guide,
// CC0): 03 03 01 01 is V1.3.3 on the owner's unit.
test('the globals reply carries the firmware version', () => {
  assert.equal(decodeFirmware(OWNER_GLOBALS), 'V1.3.3');
  assert.equal(decodeFirmware(fromHex('12 10 01 01 04 00 07 04 01 01')), 'V1.4.7');
  assert.equal(decodeFirmware(fromHex('12 10 02 01 04 00 02 00 00 00')), null, 'no version record');
  assert.equal(decodeFirmware(fromHex('12 41 01 01 04 00 03 03 01 01')), null, 'not a globals reply');
  assert.equal(TESTED_FIRMWARE, 'V1.3.3');
});
