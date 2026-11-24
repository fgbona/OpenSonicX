import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MB_WRITE, parseMbFrame } from '../src/matribox/frame.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { parseMbPreset, type MbPreset } from '../src/matribox/preset.ts';
import { mbSavePreset, mbSelectPreset, mbSetAssignments, mbSetBlockOn, mbSetChain, mbSetParam } from '../src/matribox/write.ts';
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

const DRV = (fxid: number) => ({ slot: 0, moduleIndex: 3, fxid, on: true });
const DLY = { slot: 1, moduleIndex: 9, fxid: 0x0b000001, on: true };

test('chain changes match capture 2: add, change model, add a second slot, reorder, remove', () => {
  assert.deepEqual(carried(mbSetChain([DRV(0x03000000)], 0)), echo('chain-add-drv-slot0'));
  assert.deepEqual(carried(mbSetChain([DRV(0x0300000a)], 0)), echo('chain-model-0300000a'));
  assert.deepEqual(carried(mbSetChain([DRV(0x0300000a), DLY], 1)), echo('chain-add-dly-slot1'));
  assert.deepEqual(carried(mbSetChain([DLY, DRV(0x0300000a)])), echo('chain-reorder'));
  assert.deepEqual(carried(mbSetChain([DRV(0x0300000a)], 1)), echo('chain-remove-slot1'));
});

test('the assignment tables of an empty preset are the message sent before every chain change', () => {
  assert.deepEqual(carried(mbSetAssignments()), echo('assignments'));
});

test('mbSetAssignments copies the preset\'s sec2, sec7 and sec8 tables', () => {
  const preset = parseMbPreset(fromHex(readFileSync(new URL('./fixtures/matribox-preset-drive-ad.txt', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).join('')));
  const body = (p: MbPreset, id: number) => p.sections.find((s) => s.id === id)!.body;
  const data = fromHex(carried(mbSetAssignments(preset)).data);
  assert.equal(data.length, 160);
  assert.deepEqual([...data.subarray(0, 4)], [0x04, 0x00, 0x04, 0x01]);
  assert.deepEqual([...data.subarray(4, 10)], [...body(preset, 2).subarray(4, 10)]);
  assert.deepEqual([...data.subarray(10, 100)], [...body(preset, 7).subarray(5, 95)]);
  assert.deepEqual([...data.subarray(100, 160)], [...body(preset, 8).subarray(9, 69)]);
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
  assert.throws(() => mbSetChain([]), /at least one/);
  assert.throws(() => mbSetChain([DRV(1), DRV(2)]), /twice/);
  assert.throws(() => mbSetChain([{ ...DLY, moduleIndex: 16 }]), /module/);
  assert.throws(() => mbSetChain([{ ...DLY, fxid: -1 }]), /fxid/);
  assert.throws(() => mbSetChain([DLY], 12), /focus/);
});
