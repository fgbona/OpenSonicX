import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB_WRITE, matriboxLink, parseMbFrame, parseMbPreset, unwrapMbMessage } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { FAKE_CATALOG } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { applyChain, applyOps, MbApplyError } from '../lib/matriboxOps.ts';
import { planTone, transition } from '../lib/matriboxPlan.ts';

const catalog = FAKE_CATALOG;
const unitLink = (fake: FakeMatribox) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 500);
const shape = (chain: readonly { moduleIndex: number; fxid: number; on: boolean }[]) => chain.map((b) => [b.moduleIndex, b.fxid, b.on]);

test("applyOps writes a whole tone through the unit's chain edits and lands on it, then back", async () => {
  const fake = new FakeMatribox();
  const link = unitLink(fake);
  const before = parseMbPreset(fake.editBuffer).chain;
  const tone = planTone(catalog, [
    { module: 'DRV', model: 'Fake Fuzz', params: [{ name: 'Fuzz', value: 70 }] },
    { module: 'AMP', model: 'Fake Plexi', on: false },
    { module: 'DLY', model: 'Fake Echo' },
  ]);
  const after = await applyOps(link, transition(catalog, before, tone));
  assert.deepEqual(shape(after.chain), [
    [3, 0x03000010, true],
    [4, 0x0700001a, false],
    [9, 0x0b000001, true],
  ]);
  assert.equal(after.chain[0]!.values[0], 70);
  assert.equal(after.chain[2]!.values[1], 20);
  assert.deepEqual(parseMbPreset(fake.editBuffer).chain, after.chain);

  // Undo: the old chain again, with every value the catalog names.
  const back = await applyOps(link, transition(catalog, after.chain, before));
  assert.deepEqual(shape(back.chain), shape(before));
  // Widget IDs per block of the fake catalog (the CAB at 4 is unknown: the unit's defaults stay).
  const named: [number, number[]][] = [
    [0, [0]],
    [1, [0, 1, 2]],
    [2, [0, 5]],
    [4, [0, 1]],
    [5, [0]],
  ];
  for (const [at, ids] of named) {
    for (const id of ids) assert.equal(back.chain[at]!.values[id], before[at]!.values[id], `block ${at + 1} value ${id}`);
  }
});

test('applyOps addresses the storage slot of each chain position', async () => {
  const fake = new FakeMatribox();
  const link = unitLink(fake);
  // Drive AD's DRV sits in slot 0 at position 2.
  const after = await applyOps(link, [
    { kind: 'param', position: 1, id: 0, value: 42 },
    { kind: 'on', position: 1, on: true },
  ]);
  assert.deepEqual([after.chain[1]!.slot, after.chain[1]!.values[0], after.chain[1]!.on], [0, 42, true]);
  await assert.rejects(applyOps(link, [{ kind: 'param', position: 9, id: 0, value: 1 }]), /no block at position 10/);
});

/** A link whose `failAt`-th set-param/on write the unit applies without confirming it (the owner's timeouts). */
function flakyLink(fake: FakeMatribox, failAt: number) {
  let writes = 0;
  const send = (b: Uint8Array) => {
    const frame = parseMbFrame(b);
    const data = frame.type === MB_WRITE ? unwrapMbMessage(frame.payload).data : null;
    const valueWrite = data !== null && (data[0] === 1 || data[0] === 2) && data[1] === 0 && data[2] === 5 && data[3] === 1;
    if (valueWrite && ++writes === failAt) {
      fake.echoes = false;
      fake.send(b);
      fake.echoes = true;
      return;
    }
    fake.send(b);
  };
  return matriboxLink({ send, listen: (r) => fake.listen(r ?? (() => undefined)) }, 100);
}

const TONE = () =>
  planTone(catalog, [
    { module: 'DRV', model: 'Fake Fuzz', params: [{ name: 'Fuzz', value: 70 }] },
    { module: 'AMP', model: 'Fake Plexi', params: [{ name: 'Gain', value: 65 }] },
    { module: 'DLY', model: 'Fake Echo' },
  ]);

test('applyChain rolls the unit back to the chain it had when a write fails, and says nothing was applied', async () => {
  const fake = new FakeMatribox();
  const before = parseMbPreset(fake.editBuffer).chain;
  await assert.rejects(applyChain(flakyLink(fake, 1), catalog, TONE()), (e: unknown) => {
    assert.ok(e instanceof MbApplyError);
    assert.match(e.message, /did not confirm the write.*Nothing was applied/s);
    assert.deepEqual(shape(e.preset!.chain), shape(before));
    return true;
  });
  assert.deepEqual(shape(parseMbPreset(fake.editBuffer).chain), shape(before));
});

test('a build retried after a failed one replaces the chain: no block piles up, whatever the editor showed', async () => {
  const fake = new FakeMatribox();
  await assert.rejects(applyChain(flakyLink(fake, 2), catalog, TONE()));
  await assert.rejects(applyChain(flakyLink(fake, 3), catalog, TONE()));
  const after = await applyChain(unitLink(fake), catalog, TONE());
  assert.deepEqual(shape(after.chain), shape(TONE()));
  assert.deepEqual(shape(parseMbPreset(fake.editBuffer).chain), shape(TONE()));
  assert.equal(after.chain[0]!.values[0], 70);
});

test('applyChain plans from what the unit holds and skips values it already has', async () => {
  const fake = new FakeMatribox();
  let writes = 0;
  const link = matriboxLink(
    {
      send: (b) => {
        const frame = parseMbFrame(b);
        const data = frame.type === MB_WRITE ? unwrapMbMessage(frame.payload).data : null;
        if (data && data[2] === 5 && data[3] === 1) writes++; // set param, on/off
        fake.send(b);
      },
      listen: (r) => fake.listen(r ?? (() => undefined)),
    },
    500,
  );
  await applyChain(link, catalog, TONE());
  const built = writes;
  // Fresh blocks come on, with the unit's defaults: only the two values the tone sets and the Echo's
  // Feedback (the simulated unit loads 50, the catalog says 20) are written.
  assert.equal(built, 3);
  await applyChain(link, catalog, TONE()); // the same tone again: only reads
  assert.equal(writes, built);
});
