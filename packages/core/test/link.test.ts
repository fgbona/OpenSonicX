import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame } from '../src/frame.ts';
import { toHex } from '../src/hex.ts';
import { PocketMasterLink, LinkClosedError, type LogEntry, type MidiPort } from '../src/link.ts';

/** A port that records what is sent and lets a test deliver incoming bytes. */
function fakePort(send: (b: Uint8Array) => void = () => undefined) {
  const state = { receiver: null as ((bytes: Uint8Array) => void) | null };
  const port: MidiPort = { send, listen: (r) => void (state.receiver = r) };
  return { port, state, receive: (bytes: Uint8Array) => state.receiver?.(bytes) };
}
function fakes() {
  const sent: string[] = [];
  const { port, state, receive } = fakePort((b) => void sent.push(toHex(b)));
  const log: LogEntry[] = [];
  const link = new PocketMasterLink(port, (e) => log.push(e));
  return { sent, state, link, log, receive };
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
  assert.equal(f.state.receiver, null);
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


// --- live edit path -------------------------------------------------------
import { setParam, setBlockOn, setAmpMode, selectModel, editKey } from '../src/index.ts';

test('edit refuses anything that is not a chain, model, parameter or on/off command', () => {
  const f = fakes();
  assert.throws(() => f.link.edit(buildFrame([0x11, 0x4a, 0, 0, 0, 0])), /Blocked/);
  assert.throws(() => f.link.edit(buildFrame([0x12, 0x41])), /Blocked/);
  assert.equal(f.sent.length, 0);
});

test('edit sends at once, then spaces messages and keeps only the latest per key', async () => {
  const f = fakes();
  f.link.edit(setParam(3, 4, 10));
  f.link.edit(setParam(3, 4, 11));
  f.link.edit(setParam(3, 4, 12));
  f.link.edit(setBlockOn(7, true));
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
  f.link.edit(setParam(3, 4, 10));
  f.link.edit(setParam(3, 4, 11));
  f.link.close();
  mock.timers.tick(100);
  assert.equal(f.sent.length, 1);
  assert.throws(() => f.link.edit(setParam(3, 4, 12)), LinkClosedError);
});

test('drained resolves once every queued edit is sent', async () => {
  const f = fakes();
  f.link.edit(setParam(3, 4, 10));
  f.link.edit(setParam(3, 3, 10));
  const done = f.link.drained();
  mock.timers.tick(20);
  await done;
  assert.equal(f.sent.length, 2);
});

test('a replaced edit moves behind edits queued after it, so order is kept', () => {
  const f = fakes();
  f.link.edit(setBlockOn(1, true)); // goes out at once
  f.link.edit(setParam(2, 0, 10));
  f.link.edit(buildFrame([0x11, 0x47, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 3]));
  f.link.edit(setParam(2, 0, 20)); // must follow the model change
  mock.timers.tick(20);
  mock.timers.tick(20);
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent[2], toHex(setParam(2, 0, 20)));
});

test('editKey keeps amp mode and amp model apart and groups a parameter by module and slot', () => {
  assert.notEqual(editKey(setAmpMode(false)), editKey(selectModel(3, 0x07000001)));
  assert.equal(editKey(setParam(3, 4, 10)), editKey(setParam(3, 4, 99)));
  assert.notEqual(editKey(setParam(3, 4, 10)), editKey(setParam(3, 5, 10)));
  assert.notEqual(editKey(setParam(3, 4, 10)), editKey(setParam(9, 4, 10)));
});

test('a quick second amp model choice cannot drop the queued amp mode switch', () => {
  const f = fakes();
  f.link.edit(setParam(1, 0, 5)); // busy queue
  f.link.edit(setAmpMode(false));
  f.link.edit(selectModel(3, 0x07000001));
  f.link.edit(selectModel(3, 0x07000002));
  for (let i = 0; i < 4; i++) mock.timers.tick(20);
  assert.deepEqual(f.sent.slice(1), [toHex(setAmpMode(false)), toHex(selectModel(3, 0x07000002))]);
});

test('frames nobody waits for are reported as notifications', () => {
  const seen: string[] = [];
  const { port, receive } = fakePort();
  const link = new PocketMasterLink(port, () => undefined, (fr) => seen.push(toHex(fr.payload)));
  receive(buildFrame([0x12, 0x43, 9, 0]));
  assert.deepEqual(seen, ['12 43 09 00']);
  link.close();
});

test('a reply that answers a request is not reported as a notification', async () => {
  const seen: string[] = [];
  const { port, receive } = fakePort();
  const link = new PocketMasterLink(port, () => undefined, (fr) => seen.push(toHex(fr.payload)));
  const pending = link.request(0x43);
  receive(buildFrame([0x12, 0x43, 7, 0]));
  await pending;
  assert.deepEqual(seen, []);
  link.close();
});

// --- preset operations ------------------------------------------------------
import { selectPreset, savePreset } from '../src/index.ts';

test('presetOperation refuses anything but a selection or a user-slot save', async () => {
  const f = fakes();
  await assert.rejects(f.link.presetOperation(setParam(3, 4, 50)), /Blocked/);
  await assert.rejects(f.link.presetOperation(buildFrame([0x12, 0x41])), /Blocked/);
  assert.equal(f.sent.length, 0);
});

test('a selection waits for its own acknowledge, so it cannot be mistaken for the save one', async () => {
  const f = fakes();
  let done = false;
  const select = f.link.presetOperation(selectPreset(2)).then((ok) => ((done = true), ok));
  await flush();
  assert.equal(done, false, 'still waiting for 14 08 00');
  f.receive(buildFrame([0x14, 0x08, 0x00])); // the real pedal acknowledges every selection
  assert.equal(await select, true);
  assert.deepEqual(f.sent, [toHex(selectPreset(2))]);
  // The next save waits for a new acknowledge, not the selection's.
  const save = f.link.presetOperation(savePreset(2, 'Lead'));
  await flush();
  f.receive(buildFrame([0x14, 0x08, 0x01]));
  assert.equal(await save, false);
});

test('a selection without acknowledge fails after 3 s', async () => {
  const f = fakes();
  const outcome = assert.rejects(f.link.presetOperation(selectPreset(2)), /no acknowledge for the preset selection/);
  await flush();
  mock.timers.tick(3000);
  await outcome;
});

test('a save resolves with the acknowledge and is never re-sent', async () => {
  const f = fakes();
  const ok = f.link.presetOperation(savePreset(2, 'Lead'));
  await flush();
  f.receive(buildFrame([0x14, 0x08, 0x00]));
  assert.equal(await ok, true);
  const failed = f.link.presetOperation(savePreset(2, 'Lead'));
  await flush();
  f.receive(buildFrame([0x14, 0x08, 0x01]));
  assert.equal(await failed, false);
  assert.equal(f.sent.length, 2);
});

test('a save without acknowledge fails after 3 s and is not retried', async () => {
  const f = fakes();
  const outcome = assert.rejects(f.link.presetOperation(savePreset(2, 'Lead')), /no acknowledge/);
  await flush();
  mock.timers.tick(3000);
  await outcome;
  assert.equal(f.sent.length, 1);
});

test('a preset operation waits until queued edits are written', async () => {
  const f = fakes();
  f.link.edit(setParam(3, 4, 10));
  f.link.edit(setParam(3, 3, 10));
  const op = f.link.presetOperation(selectPreset(1));
  await flush();
  assert.equal(f.sent.length, 1, 'select waits behind the queued edit');
  mock.timers.tick(20);
  await flush();
  f.receive(buildFrame([0x14, 0x08, 0x00])); // acknowledge of edit 1
  f.receive(buildFrame([0x14, 0x08, 0x00])); // acknowledge of edit 2
  await flush();
  f.receive(buildFrame([0x14, 0x08, 0x00])); // acknowledge of the select
  await op;
  assert.deepEqual(f.sent.slice(1), [toHex(setParam(3, 3, 10)), toHex(selectPreset(1))]);
});

test('a port that fails to send rejects the request with a readable error and leaves nothing pending', async () => {
  let sends = 0;
  const { port } = fakePort(() => { sends++; throw new Error('port disconnected'); });
  const link = new PocketMasterLink(port, () => undefined);
  await assert.rejects(link.request(0x43), /Could not send to the pedal: port disconnected/);
  mock.timers.tick(10_000);
  await flush();
  assert.equal(sends, 1, 'no retry after a send failure');
});

test('a preset operation waits for the acknowledges of the edits sent before it', async () => {
  const f = fakes();
  f.link.edit(setParam(3, 4, 10));
  let done = false;
  const select = f.link.presetOperation(selectPreset(1)).then(() => (done = true));
  await flush();
  assert.equal(f.sent.length, 1, 'select waits for the edit acknowledge');
  f.receive(buildFrame([0x14, 0x08, 0x00])); // the edit's acknowledge (the pedal acks every 11 48)
  await flush();
  assert.equal(f.sent.length, 2, 'now the select goes out');
  assert.equal(done, false, "the edit's acknowledge did not answer the select");
  f.receive(buildFrame([0x14, 0x08, 0x00]));
  await select;
});

test('a missing edit acknowledge delays a preset operation by at most 300 ms', async () => {
  const f = fakes();
  f.link.edit(setParam(3, 4, 10));
  const select = f.link.presetOperation(selectPreset(1));
  await flush();
  mock.timers.tick(300);
  await flush();
  assert.equal(f.sent.length, 2);
  f.receive(buildFrame([0x14, 0x08, 0x00]));
  assert.equal(await select, true);
});
