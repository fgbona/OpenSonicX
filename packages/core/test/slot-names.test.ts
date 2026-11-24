import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame } from '../src/frame.ts';
import { Reassembler } from '../src/reassembler.ts';
import { decodeSlotNames, userIrSlot } from '../src/slots.ts';
import { modelsFor } from '../src/catalog.ts';
import { readCapture } from './capture.ts';

function replies(): Uint8Array[] {
  const r = new Reassembler();
  return readCapture('slot-names-capture.txt')
    .filter((m) => m.dir === 'RX')
    .map((m) => r.feed(parseFrame(m.bytes), 0))
    .filter((f) => f !== null)
    .map((f) => f!.payload);
}

test('decodeSlotNames reads the five user IR names from the real reply', () => {
  const [irs] = replies();
  assert.deepEqual(decodeSlotNames(irs!), [
    { name: 'Marshal 80', empty: false },
    { name: 'Brutal Pri', empty: false },
    { name: 'Marshall W', empty: false },
    { name: 'Holy Grail', empty: false },
    { name: 'V30UK Md 4', empty: false },
  ]);
});

test('decodeSlotNames marks empty captured-profile slots', () => {
  const [, clones] = replies();
  assert.deepEqual(
    decodeSlotNames(clones!).map((s) => s.empty),
    [true, true, true, true, true],
  );
});

test('decodeSlotNames rejects other replies', () => {
  assert.throws(() => decodeSlotNames(Uint8Array.from([0x12, 0x41, 0])), /slot-names/);
});

test('userIrSlot maps the five User IR models to slots 0..4 and nothing else', () => {
  const ir = modelsFor('ir');
  assert.deepEqual(
    ir.filter((m) => m.name.startsWith('User IR')).map((m) => userIrSlot(m.code)),
    [0, 1, 2, 3, 4],
  );
  assert.equal(userIrSlot(ir.find((m) => m.name === 'BritGN 4x12')!.code), null);
});
