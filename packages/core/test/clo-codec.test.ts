import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLO_BIQUAD, CLO_FILE_SIZE, CLO_UPLOAD_SIZE, crc16Modbus, decodeClo, encodeClo, profileRenameBlob, profileUploadBlob } from '../src/clo/codec.ts';
import { parseReferenceDi, REFERENCE_DI } from '../src/clo/reference-di.ts';
import { isUploadBlob, UploadDomain } from '../src/ir-upload.ts';

const arrays = {
  arrayA: Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0)),
  arrayB: Float32Array.from({ length: 2048 }, (_, i) => 1 / (i + 1)),
  gains: [0.5, 0.25, 2, 3] as const,
};

test('CRC-16/MODBUS gives the standard check value', () => {
  assert.equal(crc16Modbus(new TextEncoder().encode('123456789')), 0x4b37);
});

test('a .clo file is 8840 bytes and round-trips, CRC included', () => {
  const file = encodeClo(arrays);
  assert.equal(file.length, CLO_FILE_SIZE);
  assert.equal(new TextDecoder().decode(file.subarray(0, 4)), 'VTSI');
  const view = new DataView(file.buffer);
  assert.equal(view.getUint32(4, true), 8840);
  assert.equal(view.getUint32(20, true), 8840 - 136);
  assert.equal(view.getFloat64(24, true), 1);
  assert.equal(view.getUint16(8, false), crc16Modbus(file.subarray(12)));
  const back = decodeClo(file);
  assert.deepEqual(back.biquad, CLO_BIQUAD);
  assert.deepEqual([...back.arrayA], [...arrays.arrayA]);
  assert.deepEqual([...back.arrayB], [...arrays.arrayB]);
  assert.deepEqual([...back.gains], [...arrays.gains]);
  const broken = file.slice();
  broken[700] = broken[700]! ^ 0xff;
  assert.throws(() => decodeClo(broken), /CRC mismatch/);
  assert.throws(() => decodeClo(file.subarray(0, 100)), /8840 bytes/);
});

test('the upload variant keeps the first 512 taps of arrayB: 2696 bytes', () => {
  const up = encodeClo(arrays, 512);
  assert.equal(up.length, CLO_UPLOAD_SIZE);
  assert.equal(new DataView(up.buffer).getUint32(132, true), 512);
});

test('the profile blob is 11 25, slot, name capacity 0x0F, name and the upload .clo', () => {
  const blob = profileUploadBlob(2, 'Randall SA 2', arrays);
  assert.deepEqual([...blob.subarray(0, 10)], [0x11, 0x25, 0, 0, 0, 0, 2, 0, 0, 0x0f]);
  assert.equal(new TextDecoder().decode(blob.subarray(10, 22)), 'Randall SA 2');
  assert.deepEqual(blob.subarray(74), encodeClo(arrays, 512));
  assert.ok(isUploadBlob(blob, UploadDomain.PROFILE));
  assert.equal(isUploadBlob(blob, UploadDomain.IR), false, 'a profile is not an IR');
  assert.deepEqual([...profileRenameBlob(4, 'X')].slice(0, 7), [0x11, 0x26, 4, 0, 0, 0x0f, 0x58]);
  assert.throws(() => profileUploadBlob(5, 'X', arrays), /slot must be 0\.\.4/);
  assert.throws(() => profileUploadBlob(0, 'a name too long!', arrays), /1\.\.15/);
  assert.ok(isUploadBlob(Uint8Array.of(0x11, 0x27, 0, 0, 0, 0x0f), UploadDomain.PROFILE), 'clearing a profile slot is offered');
  assert.equal(isUploadBlob(Uint8Array.of(0x11, 0x27, 0, 0, 0, 0x0f), UploadDomain.IR), false, 'but not as an IR');
});

test('the reference DI is only used when its SHA-256 matches', async () => {
  assert.match(REFERENCE_DI.url, /^https:\/\/raw\.githubusercontent\.com\/skyggedans\/SonicMaster\/931a68f4ee06263e1eb622ee0fccf9f84d2b9751\//);
  await assert.rejects(parseReferenceDi(new Uint8Array(16)), /reference DI does not match/);
});
