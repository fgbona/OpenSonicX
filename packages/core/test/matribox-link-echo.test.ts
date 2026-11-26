import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matriboxLink } from '../src/matribox/link.ts';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { unwrapMbMessage, wrapMbMessage } from '../src/matribox/message.ts';
import { mbSetBlockOn, mbSetParam } from '../src/matribox/write.ts';
import { replyFrames } from './fake-matribox.ts';

const f32 = (v: number) => Array.from(new Uint8Array(Float32Array.of(v).buffer));
const notice = (data: number[]) => replyFrames(wrapMbMessage(1, 0x10, data))[0] as Uint8Array;
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A unit that answers each write with `answer(sent data)` after `delayMs`, and logs what it got. */
function unit(answer: (data: Uint8Array) => number[] | null, delayMs = 0) {
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  const got: string[] = [];
  return {
    got,
    push: (bytes: Uint8Array) => receiver?.(bytes),
    port: {
      send: (bytes: Uint8Array) => {
        const { data } = unwrapMbMessage(parseMbFrame(bytes).payload);
        got.push(hexOf(data));
        const reply = answer(data);
        if (reply) setTimeout(() => receiver?.(notice(reply)), delayMs);
      },
      listen: (r: ((bytes: Uint8Array) => void) | null) => {
        receiver = r;
      },
    },
  };
}

test('a set-param write is confirmed by its echo with the value the unit kept (it snaps to the step and the range)', async () => {
  // Sent 6.5 on a step-1 knob: the unit keeps 7 and echoes 7 (docs/matribox.md: "echoes it with the value it kept").
  const u = unit((data) => [...data.subarray(0, 12), ...f32(7)]);
  const link = matriboxLink(u.port, 200, 0);
  await link.write(mbSetParam(3, null, 0, 6.5));
});

test('an echo of another slot or parameter does not confirm a set-param write', async () => {
  const u = unit((data) => [0x01, 0x00, 0x05, 0x01, data[4]! + 1, 0, 0, 0, ...data.subarray(8, 12), ...f32(7)]);
  await assert.rejects(matriboxLink(u.port, 100, 0).write(mbSetParam(3, null, 0, 6.5)), /did not confirm the write/);
});

test("a block on/off write is confirmed by its slot's echo even when the unit kept the other state", async () => {
  const u = unit((data) => [...data.subarray(0, 8), 0, 0, 0, 0]);
  await matriboxLink(u.port, 200, 0).write(mbSetBlockOn(2, true));
});

test('the link sends no flush read while a request waits for its answer', async () => {
  const u = unit((data) => (data[0] === 0x01 ? [...data] : null), 120); // writes echoed late; flush reads unanswered
  const link = matriboxLink(u.port, 1000, 10);
  link.onNotice(() => undefined);
  u.push(notice([0x01, 0x00, 0x05, 0x01, 2, 0, 0, 0, 0, 0, 0, 0, ...f32(40)])); // a knob turned on the unit: the flush starts
  await new Promise((r) => setTimeout(r, 25));
  const before = u.got.length;
  await link.write(mbSetParam(1, null, 0, 50));
  const sentWrite = u.got.indexOf(hexOf(unwrapMbMessage(parseMbFrame(mbSetParam(1, null, 0, 50)).payload).data));
  assert.ok(before > 0 && sentWrite >= before, 'the flush ran before the write');
  assert.deepEqual(u.got.slice(sentWrite + 1), [], 'reads sent while the write waited');
  link.onNotice(null);
});
