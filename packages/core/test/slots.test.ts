import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  selectPreset, savePreset, encodeName, setPresetVolume, isPresetOperation, decodePresetNames, decodeAck,
} from '../src/slots.ts';
import { isAllowedEdit, setParam } from '../src/commands.ts';
import { buildFrame, parseFrame, expand, crc8 } from '../src/frame.ts';
import { Reassembler } from '../src/reassembler.ts';
import { queryFrame, Query } from '../src/queries.ts';
import { toHex, fromHex } from '../src/hex.ts';
import { readCapture } from './capture.ts';

type Lib = { presetCommands: Record<'user' | 'factory', Record<string, string>>; globalCommands: { presetVolume: Record<string, string> } };
const lib = JSON.parse(readFileSync(new URL('./fixtures/pocketedit-commands.json', import.meta.url), 'utf8')) as Lib;
const capture = (h: string) => h.toUpperCase().replace(/^8080/, '').replace(/(..)(?!$)/g, '$1 ');
const indexOf = (label: string) => (label[0] === 'P' ? 0 : 50) + Number(label.slice(1)) - 1;

test('selectPreset matches every captured preset selection', () => {
  for (const bank of ['user', 'factory'] as const) {
    for (const [label, hex] of Object.entries(lib.presetCommands[bank])) {
      assert.equal(toHex(selectPreset(indexOf(label))), capture(hex), label);
    }
  }
  assert.throws(() => selectPreset(100), /0\.\.99/);
});

test('setPresetVolume matches every captured preset volume command', () => {
  for (const [value, hex] of Object.entries(lib.globalCommands.presetVolume)) {
    assert.equal(toHex(setPresetVolume(Number(value))), capture(hex), value);
  }
  assert.throws(() => setPresetVolume(101), /0\.\.100/);
  assert.equal(isAllowedEdit(setPresetVolume(65)), true, 'volume is a live edit');
});

test('savePreset matches the documented save template', () => {
  // PocketEdit save template: 0001000001030101040a {IDX} 000000000000 {NAME} 000000000000
  const name = Array.from('Lead', (c) => c.charCodeAt(0)).flatMap((c) => [c >> 4, c & 15]);
  const body = [...fromHex('0001000001030101040a0001000000000000'), ...name, ...new Array(12).fill(0), ...new Array(6).fill(0)];
  const logical = Array.from({ length: body.length / 2 }, (_, i) => (body[2 * i]! << 4) | body[2 * i + 1]!);
  const expected = [0xf0, ...expand([crc8(logical)]), ...body, 0xf7];
  assert.equal(toHex(savePreset(1, 'Lead')), toHex(expected));
});

test('savePreset refuses factory slots and bad names before building anything', () => {
  assert.throws(() => savePreset(50, 'x'), /P01\.\.P50/);
  assert.throws(() => savePreset(0, 'Way too long'), /1\.\.10/);
  assert.throws(() => savePreset(0, ''), /1\.\.10/);
  assert.throws(() => encodeName('Café'), /ASCII/);
  assert.deepEqual(encodeName('Rhythm'), [82, 104, 121, 116, 104, 109, 0, 0, 0, 0]);
});

test('isPresetOperation accepts only selections and user-slot saves', () => {
  assert.equal(isPresetOperation(selectPreset(99)), true);
  assert.equal(isPresetOperation(savePreset(49, 'Lead')), true);
  assert.equal(isPresetOperation(buildFrame([0x11, 0x4a, 50, 0, 0, 0, 76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false, 'factory save');
  assert.equal(isPresetOperation(buildFrame([0x11, 0x4a, 1, 0])), false, 'truncated save');
  assert.equal(isPresetOperation(setParam(3, 4, 50)), false);
  assert.equal(isPresetOperation(queryFrame(Query.EDIT_BUFFER)), false);
  assert.equal(isAllowedEdit(savePreset(1, 'Lead')), false, 'edit path still refuses save');
  assert.equal(isAllowedEdit(selectPreset(1)), false, 'edit path still refuses select');
});

test('decodePresetNames reads the 100 names from the real reply', () => {
  const r = new Reassembler();
  const rx = readCapture('names-capture.txt').filter((m) => m.dir === 'RX').slice(2);
  const joined = rx.map((m) => r.feed(parseFrame(m.bytes), 0)).at(-1);
  assert.ok(joined);
  const names = decodePresetNames(joined.payload);
  assert.equal(names.length, 100);
  assert.deepEqual(names.slice(0, 3), ['MTL-CLEAN', 'MTL-RHY', 'MTL-LEAD']);
  assert.deepEqual([names[48], names[49], names[50], names[99]], ['Rhythm', 'Lead', 'PoketMastr', 'Bass Q']);
  assert.throws(() => decodePresetNames(Uint8Array.from([0x12, 0x41])), /preset-names/);
});

test('decodeAck reads ok and failure', () => {
  assert.equal(decodeAck(Uint8Array.from([0x14, 0x08, 0x00])), true);
  assert.equal(decodeAck(Uint8Array.from([0x14, 0x08, 0x01])), false);
  assert.throws(() => decodeAck(Uint8Array.from([0x12, 0x43, 0])), /acknowledge/);
});
