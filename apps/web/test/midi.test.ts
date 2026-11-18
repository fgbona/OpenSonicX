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
