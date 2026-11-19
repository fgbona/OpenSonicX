import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelsFor } from '../src/catalog.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { applyEdit } from '../src/edit.ts';
import { decodeNotification } from '../src/notify.ts';
import { resolveBlock, resolveParam } from '../src/resolve.ts';
import { delayMs, paramSpecFor, SYNC_DIVISIONS, TAP_DIVISIONS } from '../src/tempo.ts';
import { buildFrame, parseFrame } from '../src/frame.ts';
import { realP08 } from './fake-pedal.ts';

const block = (p: Preset, key: string) => p.chain.find((b) => b.key === key)!;

/** P08 with the delay's Sync (slot 3) switched on and its Time slot holding a division index. */
function syncedDelay(index: number): Preset {
  const p = decodePreset(realP08());
  const withSync = applyEdit(p, { kind: 'param', module: 7, alg: 3, value: 1 });
  return applyEdit(withSync, { kind: 'param', module: 7, alg: 1, value: index });
}

test('the catalog links each tempo-syncable Time or Rate to its Sync switch', () => {
  const analog = modelsFor('dly').find((m) => m.name === 'Analog')!;
  assert.equal(analog.params.find((p) => p.name === 'Time')!.syncedBy, 3);
  const phaser = modelsFor('fx1').find((m) => m.name === 'Phaser')!;
  assert.equal(phaser.params.find((p) => p.name === 'Rate')!.syncedBy, 1);
  assert.equal(SYNC_DIVISIONS.length, 11);
  assert.deepEqual([SYNC_DIVISIONS[0], SYNC_DIVISIONS[4], SYNC_DIVISIONS[10]], ['1/1', '1/4', '1/16']);
});

test('with Sync off, Time is milliseconds; with Sync on, the same slot is a note division', () => {
  const p = decodePreset(realP08());
  const time = block(p, 'dly').params.find((x) => x.name === 'Time')!;
  assert.equal(time.kind, 'number');
  assert.equal(time.display, '400 ms');
  const synced = syncedDelay(4);
  const syncedTime = block(synced, 'dly').params.find((x) => x.name === 'Time')!;
  assert.equal(syncedTime.kind, 'select');
  assert.equal(syncedTime.display, '1/4');
});

test('parameter specs follow Sync, so a division is set by name and a millisecond value is refused', () => {
  const synced = syncedDelay(4);
  const dly = resolveBlock(synced, 'dly');
  const spec = resolveParam(synced, dly, 'time');
  assert.equal(spec.type, 'select');
  assert.deepEqual(spec.options, SYNC_DIVISIONS);
  assert.equal(paramSpecFor(decodePreset(realP08()), block(decodePreset(realP08()), 'dly'), 1)?.type, undefined, 'plain number with Sync off');
});

test('tap divisions turn a BPM into delay milliseconds', () => {
  assert.deepEqual(TAP_DIVISIONS.map((d) => d.label), ['1/8', '1/8·', '1/4', '1/2']);
  assert.equal(delayMs(120, 1), 500);
  assert.equal(delayMs(120, 0.75), 375);
  assert.equal(delayMs(90, 0.5), 333);
});

test('a footswitch change made on the unit (12 4D) makes the editor re-read', () => {
  const p = decodePreset(realP08());
  assert.deepEqual(decodeNotification(parseFrame(buildFrame([0x12, 0x4d, 0x00, 0x07, 0x01])).payload, p), { kind: 'reread' });
});
