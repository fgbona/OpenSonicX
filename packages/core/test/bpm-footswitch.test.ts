import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editKey, isAllowedEdit, setFootswitch } from '../src/commands.ts';
import { decodePreset, type Preset } from '../src/dump.ts';
import { applyEdit, diffPresets, editToCommands, type Edit } from '../src/edit.ts';
import { buildFrame } from '../src/frame.ts';
import { toHex } from '../src/hex.ts';
import { setPresetVolume } from '../src/slots.ts';
import { FakePedal, realP08 } from './fake-pedal.ts';

const hex = (frames: Uint8Array[]) => frames.map(toHex);
const block = (p: Preset, key: string) => p.chain.find((b) => b.key === key)!;
const MODULE = { NR: 0, FX1: 1, DRV: 2, AMP: 3, DLY: 7, RVB: 8 } as const;

/** P08 with footswitch masks written into the dump's last group (two u32: FS1, FS2). */
function withMasks(fs1: number, fs2: number): Uint8Array {
  const p = realP08();
  const at = p.length - 8; // group 0x0003, 8 data bytes, is the dump's last group
  assert.deepEqual([...p.subarray(at - 4, at)], [0x03, 0x00, 0x08, 0x00], 'footswitch group header');
  const view = new DataView(p.buffer, p.byteOffset);
  view.setUint32(at, fs1, true);
  view.setUint32(at + 4, fs2, true);
  return p;
}

test('the dump gives the preset BPM (record 0x2002) and no footswitch on P08', () => {
  const p08 = decodePreset(realP08());
  assert.equal(p08.bpm, 120);
  assert.ok(p08.chain.every((b) => b.footswitch === null));
});

test('footswitch masks map module bits to FS1 / FS2; FS1 wins if both are set', () => {
  const p = decodePreset(withMasks((1 << MODULE.NR) | (1 << MODULE.DLY) | (1 << MODULE.AMP), (1 << MODULE.RVB) | (1 << MODULE.AMP)));
  assert.equal(block(p, 'nr').footswitch, 'fs1');
  assert.equal(block(p, 'dly').footswitch, 'fs1');
  assert.equal(block(p, 'rvb').footswitch, 'fs2');
  assert.equal(block(p, 'amp').footswitch, 'fs1');
  assert.equal(block(p, 'drv').footswitch, null);
});

test('footswitch commands have the exact bytes and pass the live-edit guard', () => {
  assert.equal(toHex(setFootswitch('fs2', MODULE.DLY, true)), toHex(buildFrame([0x11, 0x4d, 0x01, 0x07, 0x01])));
  assert.equal(toHex(setFootswitch('fs1', MODULE.NR, false)), toHex(buildFrame([0x11, 0x4d, 0x00, 0x00, 0x00])));
  assert.ok(isAllowedEdit(setFootswitch('fs1', 2, true)));
  assert.throws(() => setFootswitch('fs1', 9, true), /module must be 0\.\.8/);
});

test('switches are queued per switch and module', () => {
  assert.notEqual(editKey(setFootswitch('fs1', 7, true)), editKey(setFootswitch('fs2', 7, false)));
  assert.equal(editKey(setFootswitch('fs1', 7, true)), editKey(setFootswitch('fs1', 7, false)));
});

test('moving a block to the other switch turns the new one on, then the old one off', () => {
  const p = decodePreset(withMasks(1 << MODULE.DLY, 0));
  const edit: Edit = { kind: 'footswitch', module: MODULE.DLY, footswitch: 'fs2' };
  assert.deepEqual(hex(editToCommands(p, edit)), hex([setFootswitch('fs2', MODULE.DLY, true), setFootswitch('fs1', MODULE.DLY, false)]));
  assert.equal(block(applyEdit(p, edit), 'dly').footswitch, 'fs2');
  assert.deepEqual(hex(editToCommands(p, { kind: 'footswitch', module: MODULE.DLY, footswitch: null })), hex([setFootswitch('fs1', MODULE.DLY, false)]));
  assert.deepEqual(editToCommands(p, { kind: 'footswitch', module: MODULE.DLY, footswitch: 'fs1' }), []);
});

test('a switch takes at most three blocks', () => {
  const full = decodePreset(withMasks((1 << MODULE.NR) | (1 << MODULE.FX1) | (1 << MODULE.DLY), 0));
  assert.throws(() => editToCommands(full, { kind: 'footswitch', module: MODULE.RVB, footswitch: 'fs1' }), /FS1 already switches 3 blocks/);
});

test('diff brings footswitches back, freeing a switch before filling it, and never writes the BPM', () => {
  const target = decodePreset(withMasks((1 << MODULE.NR) | (1 << MODULE.FX1) | (1 << MODULE.RVB), 1 << MODULE.DLY));
  const from = decodePreset(withMasks((1 << MODULE.NR) | (1 << MODULE.FX1) | (1 << MODULE.DLY), 0));
  const fromBpm: Preset = { ...from, bpm: 90 };
  const edits = diffPresets(fromBpm, target);
  const after = edits.reduce(applyEdit, fromBpm);
  assert.deepEqual(diffPresets(after, target), []); // a BPM difference alone produces no edit
  // DLY leaves FS1 before RVB joins it, so FS1 never holds four blocks
  const commands = edits.reduce<{ p: Preset; n: number }>((acc, e) => ({ p: applyEdit(acc.p, e), n: acc.n + editToCommands(acc.p, e).length }), { p: fromBpm, n: 0 });
  assert.ok(commands.n > 0);
  assert.ok(edits.every((e) => (e.kind as string) !== 'bpm'));
});

test('on the simulated pedal, footswitch edits land in the dump', async () => {
  const pedal = new FakePedal();
  const before = decodePreset(await pedal.readEditBuffer());
  const edits: Edit[] = [{ kind: 'footswitch', module: MODULE.DLY, footswitch: 'fs1' }, { kind: 'footswitch', module: MODULE.RVB, footswitch: 'fs2' }];
  let p = before;
  for (const e of edits) {
    await pedal.sendEdits(editToCommands(p, e));
    p = applyEdit(p, e);
  }
  const after = decodePreset(await pedal.readEditBuffer());
  assert.equal(block(after, 'dly').footswitch, 'fs1');
  assert.equal(block(after, 'rvb').footswitch, 'fs2');
  assert.deepEqual(diffPresets(after, p), []);
});
