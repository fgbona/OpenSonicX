import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB_CATALOG } from '../src/matribox/catalog.ts';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { unwrapMbMessage, wrapMbMessage } from '../src/matribox/message.ts';
import { mbSetParam } from '../src/matribox/write.ts';
import { replyFrames } from './fake-matribox.ts';

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const dataOf = (frame: Uint8Array) => hexOf(unwrapMbMessage(parseMbFrame(frame).payload).data);
/** CAB 0x0a000022 (Marshall 4x12 Greenback): Volume, Low Cut, High Cut at widget IDs 1, 5, 6. */
const CAB = MB_CATALOG.modules.find((m) => m.name === 'CAB')!.models.find((m) => m.fxid === 0x0a000022)!;

/** A unit that answers each write with `answer(sent data)`. */
function unit(answer: (data: Uint8Array) => number[]) {
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  return {
    send: (bytes: Uint8Array) => {
      const reply = answer(unwrapMbMessage(parseMbFrame(bytes).payload).data);
      setTimeout(() => receiver?.(replyFrames(wrapMbMessage(1, 0x10, reply))[0] as Uint8Array), 0);
    },
    listen: (r: ((bytes: Uint8Array) => void) | null) => {
      receiver = r;
    },
  };
}

test("the catalog's CAB 0x0a000022 has its knobs at widget IDs 1, 5, 6 (matribox-studio: order 0, 1, 2)", () => {
  assert.deepEqual(
    CAB.params.map((p) => [p.name, p.id]),
    [
      ['Volume', 1],
      ['Low Cut', 5],
      ['High Cut', 6],
    ],
  );
});

test("a set param carries the parameter's order in its model, not its widget ID", () => {
  // Low Cut (ID 5) is the CAB's second parameter: order 1.
  assert.equal(dataOf(mbSetParam(2, CAB, 5, 80)), '01 00 05 01 02 00 00 00 01 00 00 00 00 00 a0 42');
  assert.equal(dataOf(mbSetParam(2, CAB, 1, 50)), '01 00 05 01 02 00 00 00 00 00 00 00 00 00 48 42');
  // No model: the ID goes as it is (what mb-46 sent).
  assert.equal(dataOf(mbSetParam(2, null, 5, 80)), '01 00 05 01 02 00 00 00 05 00 00 00 00 00 a0 42');
});

test('a set param of a widget ID the model does not have is refused before anything is sent', () => {
  assert.throws(() => mbSetParam(2, CAB, 0, 50), /no parameter id 0 \(its ids: 1, 5, 6\)/);
});

test('the echo of a set param names the widget ID: it confirms the write that carried the order', async () => {
  // The unit: order 1 of the CAB is knob 5, echoed with the value it kept.
  const port = unit((data) => [...data.subarray(0, 8), 5, 0, 0, 0, ...data.subarray(12, 16)]);
  await matriboxLink(port, 200, 0).write(mbSetParam(2, CAB, 5, 80));
});

test('capture mb-46: an echo of the same slot naming another parameter is a refusal, said at once, not a 3 s timeout', async () => {
  // To the unit: slot 2, ID 5, 80.0. From the unit: slot 2, ID 0, 80.0 (order 5 is past the CAB's three).
  const port = unit(() => [0x01, 0x00, 0x05, 0x01, 0x02, 0, 0, 0, 0x00, 0, 0, 0, 0x00, 0x00, 0xa0, 0x42]);
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  const started = Date.now();
  try {
    await assert.rejects(matriboxLink(port, 3000, 0).write(mbSetParam(2, null, 5, 80)), /took the write for parameter 0 instead of 5 \(slot 2\)/);
  } finally {
    console.error = log;
  }
  assert.ok(Date.now() - started < 1000, 'refused without waiting for the timeout');
  // The log has the frame sent and what the unit said.
  assert.match(String(errors[0]), /sent: .*\nheard \(last 10, decompressed\):\nflag 1 cmd 0x10: 01 00 05 01 02 00 00 00 00 00 00 00 00 00 a0 42/);
});

test('a write that times out logs the frame sent and the messages heard meanwhile', async () => {
  const port = unit(() => [0x00, 0x08, 0x00, 0x00, 1, 0, 0, 0]); // something else, never the echo
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  try {
    await assert.rejects(matriboxLink(port, 100, 0).write(mbSetParam(2, CAB, 5, 80)), /did not confirm the write \(flag 1, cmd 0x10\) within 100 ms/);
  } finally {
    console.error = log;
  }
  assert.match(String(errors[0]), /heard \(last 10, decompressed\):\nflag 1 cmd 0x10: 00 08 00 00 01 00 00 00/);
});
