import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, toHex } from '@pocket-master/core';
import { PocketMasterLink, pickPocketMaster, LinkClosedError, type LogEntry } from '../lib/midi.ts';

// Minimal fakes: the link only uses input.onmidimessage and output.send.
function fakes() {
  const sent: string[] = [];
  const input = { onmidimessage: null as ((e: { data: Uint8Array }) => void) | null };
  const output = { send: (b: Uint8Array) => void sent.push(toHex(b)) };
  const log: LogEntry[] = [];
  const link = new PocketMasterLink(input as unknown as MIDIInput, output as unknown as MIDIOutput, (e) => log.push(e));
  const receive = (bytes: Uint8Array) => input.onmidimessage?.({ data: bytes });
  return { sent, input, link, log, receive };
}
const flush = () => new Promise((r) => setImmediate(r));
const CURRENT_PRESET = 0x43;
const reply = buildFrame([0x12, 0x43, 7, 0]);

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('request resolves with the reply', async () => {
  const f = fakes();
  const pending = f.link.request(CURRENT_PRESET);
  f.receive(reply);
  assert.equal(toHex((await pending).payload), '12 43 07 00');
  assert.equal(f.sent.length, 1);
});

test('request retries after a timeout, then succeeds', async () => {
  const f = fakes();
  const pending = f.link.request(CURRENT_PRESET);
  mock.timers.tick(1500);
  await flush();
  assert.equal(f.sent.length, 2);
  f.receive(reply);
  assert.equal(toHex((await pending).payload), '12 43 07 00');
});

test('request fails with a readable error after three timeouts', async () => {
  const f = fakes();
  const outcome = assert.rejects(f.link.request(CURRENT_PRESET), /did not answer query 12 43 after 3 tries/);
  for (let i = 0; i < 3; i++) {
    mock.timers.tick(1500);
    await flush();
  }
  await outcome;
  assert.equal(f.sent.length, 3);
});

test('close cancels a pending request and nothing more is sent', async () => {
  const f = fakes();
  const pending = f.link.request(CURRENT_PRESET);
  f.link.close();
  await assert.rejects(pending, LinkClosedError);
  mock.timers.tick(5000);
  await flush();
  assert.equal(f.sent.length, 1);
  await assert.rejects(f.link.request(CURRENT_PRESET), LinkClosedError);
  assert.equal(f.sent.length, 1);
  assert.equal(f.input.onmidimessage, null);
});

test('a notification between replies is logged but does not answer the query', async () => {
  const f = fakes();
  const pending = f.link.request(0x41);
  f.receive(buildFrame([0x12, 0x48, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0x8e, 0x42]));
  mock.timers.tick(1499);
  await flush();
  assert.equal(f.sent.length, 1);
  assert.equal(f.log.at(-1)?.note, 'parameter changed');
  f.link.close();
  await assert.rejects(pending, LinkClosedError);
});

test('pickPocketMaster never falls back to another device', () => {
  const ports = [{ name: 'UMC404HD 192k' }, { name: 'Pocket Master' }] as MIDIPort[];
  assert.equal(pickPocketMaster(ports)?.name, 'Pocket Master');
  assert.equal(pickPocketMaster([{ name: 'UMC404HD 192k' }] as MIDIPort[]), undefined);
});

// --- live edit path -------------------------------------------------------
import { setParam, setBlockOn } from '@pocket-master/core';

test('edit refuses anything that is not a chain, model, parameter or on/off command', () => {
  const f = fakes();
  assert.throws(() => f.link.edit('save', buildFrame([0x11, 0x4a, 0, 0, 0, 0])), /Blocked/);
  assert.throws(() => f.link.edit('query', buildFrame([0x12, 0x41])), /Blocked/);
  assert.equal(f.sent.length, 0);
});

test('edit sends at once, then spaces messages and keeps only the latest per key', async () => {
  const f = fakes();
  f.link.edit('3:4', setParam(3, 4, 10));
  f.link.edit('3:4', setParam(3, 4, 11));
  f.link.edit('3:4', setParam(3, 4, 12));
  f.link.edit('on:7', setBlockOn(7, true));
  assert.deepEqual(f.sent, [toHex(setParam(3, 4, 10))]);
  mock.timers.tick(20);
  assert.deepEqual(f.sent.slice(1), [toHex(setParam(3, 4, 12))]);
  mock.timers.tick(20);
  assert.deepEqual(f.sent.slice(2), [toHex(setBlockOn(7, true))]);
  mock.timers.tick(100);
  assert.equal(f.sent.length, 3);
});

test('edit after close throws and queued edits are dropped', () => {
  const f = fakes();
  f.link.edit('3:4', setParam(3, 4, 10));
  f.link.edit('3:4', setParam(3, 4, 11));
  f.link.close();
  mock.timers.tick(100);
  assert.equal(f.sent.length, 1);
  assert.throws(() => f.link.edit('3:4', setParam(3, 4, 12)), LinkClosedError);
});

test('drained resolves once every queued edit is sent', async () => {
  const f = fakes();
  f.link.edit('a', setParam(3, 4, 10));
  f.link.edit('b', setParam(3, 3, 10));
  const done = f.link.drained();
  mock.timers.tick(20);
  await done;
  assert.equal(f.sent.length, 2);
});

test('a replaced edit moves behind edits queued after it, so order is kept', () => {
  const f = fakes();
  f.link.edit('first', setBlockOn(1, true)); // goes out at once
  f.link.edit('param:2:0', setParam(2, 0, 10));
  f.link.edit('model:2', buildFrame([0x11, 0x47, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 3]));
  f.link.edit('param:2:0', setParam(2, 0, 20)); // must follow the model change
  mock.timers.tick(20);
  mock.timers.tick(20);
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent[2], toHex(setParam(2, 0, 20)));
});
