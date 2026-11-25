import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { mbReadCurrentPresetNumber, unwrapMbMessage } from '../src/matribox/message.ts';
import { parseMbNotice } from '../src/matribox/notice.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { mbSelectPreset } from '../src/matribox/write.ts';
import { FakeMatribox } from './fake-matribox.ts';

const FRAMES = new Map(
  readFileSync(new URL('./fixtures/matribox-notices.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [kind, , ...bytes] = l.split(' ');
      return [kind as string, Uint8Array.from(bytes.map((h) => parseInt(h, 16)))] as const;
    }),
);
const frame = (kind: string) => FRAMES.get(kind) as Uint8Array;
const notice = (kind: string) => parseMbNotice(unwrapMbMessage(parseMbFrame(frame(kind)).payload));
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('the notices the unit sent on its own decode to what was done on the unit', () => {
  assert.deepEqual(notice('preset'), { kind: 'preset', index: 0x43 }); // footswitch to 17D "Cry&Cry"
  assert.deepEqual(notice('blocksOn'), { kind: 'blocksOn', on: [false, true, true, true, true, true, true, true, false, false, false, false] });
  assert.deepEqual(notice('param'), { kind: 'param', slot: 0, id: 0, value: 35 }); // knob 1
  assert.deepEqual(notice('volume'), { kind: 'volume', value: 42 }); // knob 3
  assert.deepEqual(notice('edited'), { kind: 'edited', edited: true });
  assert.deepEqual(notice('blockOn'), { kind: 'blockOn', slot: 1, on: false });
  assert.equal(notice('unknown'), null); // 08 00 05 01: not decoded
});

test('replies, other flags and short data are not notices', () => {
  assert.equal(parseMbNotice({ flag: 0, cmd: 0x11, data: Uint8Array.of(0, 0x52, 0, 0, 1, 0, 0, 0) }), null);
  assert.equal(parseMbNotice({ flag: 1, cmd: 0x10, data: Uint8Array.of(1, 0, 0x0a, 1) }), null);
});

test('the link hands notices to onNotice between and during requests, never its own answers', async () => {
  const fake = new FakeMatribox();
  const link = matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 1000);
  const seen: unknown[] = [];
  link.onNotice((n) => seen.push(n));
  fake.emit(frame('preset')); // between requests
  await tick();
  fake.noise = [frame('blockOn')]; // arrives before each answer
  await link.write(mbSelectPreset(5)); // its echo has the preset notice's bytes: the write takes it
  await link.read(mbReadCurrentPresetNumber()); // so does this reply
  const blockOff = { kind: 'blockOn', slot: 1, on: false };
  assert.deepEqual(seen, [{ kind: 'preset', index: 0x43 }, blockOff, blockOff]);
  link.onNotice(null);
  fake.emit(frame('preset'));
  await tick();
  assert.equal(seen.length, 3);
});
