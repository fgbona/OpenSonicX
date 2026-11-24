import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinMbPages, MB_HOST_PAGE_SIZE, MB_WRITE, parseMbFrame } from '../src/matribox/frame.ts';
import { parseMbPreset } from '../src/matribox/preset.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { mbWritePreset, mbAddBlock, mbChangeModel, mbMoveBlock, mbRemoveBlock, mbSavePreset, mbSelectPreset, mbSetBlockOn, mbSetParam } from '../src/matribox/write.ts';
import { fromHex, toHex } from '../src/hex.ts';

// Real host frames from capture 1 (cap3): set param, on/off, cmd 05, select.
const HOST = readFileSync(new URL('./fixtures/matribox-capture.txt', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.startsWith('>>')).map((l) => fromHex(l.slice(3)));
// Capture 2: the unit's echoes of the official editor's writes, decompressed, by name.
const ECHOES = new Map(readFileSync(new URL('./fixtures/matribox-writes.txt', import.meta.url), 'utf8')
  .split('\n').filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(' ')).map(([name, flag, cmd, data]) => [name as string, { flag: Number(flag), cmd: parseInt(cmd as string, 16), data: data as string }]));

const echo = (name: string) => {
  const found = ECHOES.get(name);
  assert.ok(found, `fixture has ${name}`);
  return found;
};
/** What a write frame carries: type, flag, cmd and decompressed data as hex. */
function carried(frame: Uint8Array) {
  const parsed = parseMbFrame(frame);
  assert.equal(parsed.type, MB_WRITE);
  assert.equal(parsed.checksumOk, true);
  const message = unwrapMbMessage(parsed.payload);
  return { flag: message.flag, cmd: message.cmd, data: Buffer.from(message.data).toString('hex') };
}

test('set param, block on/off and select rebuild the official editor\'s frames byte for byte', () => {
  assert.equal(toHex(mbSetParam(2, 0, 31)), toHex(HOST[2] as Uint8Array));
  assert.equal(toHex(mbSetBlockOn(1, false)), toHex(HOST[3] as Uint8Array));
  assert.equal(toHex(mbSelectPreset(0x42)), toHex(HOST[5] as Uint8Array));
});

test('cmd 05 (save) rebuilds the captured host frame: u32 index + 17-byte name field', () => {
  assert.equal(toHex(mbSavePreset(0x43, 'Cry&Cry')), toHex(HOST[4] as Uint8Array));
  assert.deepEqual(carried(mbSavePreset(0xef, 'TESTE OSX')), echo('save-60D'));
});

test('set param, on/off and select match capture 2', () => {
  assert.deepEqual(carried(mbSelectPreset(0xef)), echo('select-60D'));
  assert.deepEqual(carried(mbSetParam(0, 0, 41)), echo('param-slot0-id0-41'));
  assert.deepEqual(carried(mbSetParam(0, 0, 53)), echo('param-slot0-id0-53'));
  assert.deepEqual(carried(mbSetParam(1, 0, 45)), echo('param-slot1-id0-45'));
  assert.deepEqual(carried(mbSetBlockOn(1, false)), echo('on-slot1-off'));
});

// Captures 3 and 4: the official editor's own host frames for chain edits, by name.
const CHAIN = new Map(readFileSync(new URL('./fixtures/matribox-chain-edits.txt', import.meta.url), 'utf8')
  .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' ') as [string, string]));
const chainFrame = (name: string) => {
  const hex = CHAIN.get(name);
  assert.ok(hex, `fixture has ${name}`);
  return toHex(fromHex(hex));
};

test('chain edits rebuild the official editor\'s host frames byte for byte', () => {
  assert.equal(toHex(mbChangeModel(0, 3, 0x03000000)), chainFrame('model-drv-skreamer'));
  assert.equal(toHex(mbChangeModel(0, 3, 0x0300000a)), chainFrame('model-drv-full-od'));
  assert.equal(toHex(mbAddBlock(1, 9, 0x0b000001)), chainFrame('add-dly-at-1'));
  assert.equal(toHex(mbMoveBlock(1, 0)), chainFrame('move-1-to-0'));
  assert.equal(toHex(mbRemoveBlock(0)), chainFrame('remove-at-0'));
});

test('the builders refuse what the unit cannot hold', () => {
  assert.throws(() => mbSetParam(12, 0, 1), /slot/);
  assert.throws(() => mbSetParam(0, 15, 1), /parameter id/);
  assert.throws(() => mbSetParam(0, 0, Number.NaN), /finite/);
  assert.throws(() => mbSetBlockOn(-1, true), /slot/);
  assert.throws(() => mbSelectPreset(240), /preset/);
  assert.throws(() => mbSavePreset(0, ''), /name/);
  assert.throws(() => mbSavePreset(0, 'x'.repeat(17)), /name/);
  assert.throws(() => mbSavePreset(0, 'Café'), /name/);
  assert.throws(() => mbAddBlock(12, 3, 1), /position/);
  assert.throws(() => mbAddBlock(0, 16, 1), /module/);
  assert.throws(() => mbChangeModel(0, 3, -1), /fxid/);
  assert.throws(() => mbMoveBlock(0, 12), /position/);
  assert.throws(() => mbRemoveBlock(-1), /position/);
});

// The owner's unit: preset 66 "Drive AD" (decompressed device reply, 1211 bytes).
const DRIVE_AD = fromHex(readFileSync(new URL('./fixtures/matribox-preset-drive-ad.txt', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).join(''));
const PRST_TAG = [0x02, 0x00, 0x00, 0x10];

test('mbWritePreset: flag 2, cmd 10, u32 index + the 1207-byte body with the .prst section tags, paged', () => {
  const frames = mbWritePreset(0xe3, parseMbPreset(DRIVE_AD));
  const pages = frames.map(parseMbFrame);
  assert.ok(pages.length > 1 && pages.every((p) => p.type === MB_WRITE && p.checksumOk === true));
  assert.ok(pages.slice(0, -1).every((p) => p.payload.length === MB_HOST_PAGE_SIZE));
  const message = unwrapMbMessage(joinMbPages(pages) as Uint8Array);
  assert.deepEqual([message.flag, message.cmd, message.data.length], [2, 0x10, 1211]);
  // What the official editor sent in capture mb-20: the index, then each section tagged 0x10000002.
  const expected = Uint8Array.from(DRIVE_AD);
  expected.set([0xe3, 0, 0, 0], 0);
  for (let at = 4, i = 0; i < 9; i++) {
    expected.set(PRST_TAG, at);
    at += 8 + new DataView(expected.buffer).getUint32(at + 4, true);
  }
  assert.deepEqual(message.data, expected);
  assert.throws(() => mbWritePreset(240, parseMbPreset(DRIVE_AD)), /preset index/);
});
