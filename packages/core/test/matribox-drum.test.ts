import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/hex.ts';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { unwrapMbMessage, wrapMbMessage } from '../src/matribox/message.ts';
import { parseMbNotice } from '../src/matribox/notice.ts';
import {
  MB_DRUM_GENRES,
  MB_DRUM_PATTERNS,
  mbDrumChangeOf,
  mbDrumPatternName,
  mbDrumText,
  mbDrumWith,
  mbFindDrumRhythm,
  mbReadDrum,
  mbSetDrum,
  mbWriteDrum,
  parseMbDrum,
} from '../src/matribox/drum.ts';
import { FakeMatribox } from './fake-matribox.ts';

const sent = (frame: Uint8Array) => {
  const m = unwrapMbMessage(parseMbFrame(frame).payload);
  return `${m.flag} ${m.cmd.toString(16)} ${toHex(m.data)}`;
};
const linkTo = (fake: FakeMatribox) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 500);

test('the drum writes are cmd 0x11 settings 0x81..0x86 (waveod global_msgs.c)', () => {
  assert.equal(sent(mbSetDrum('playing', 1)), '1 11 00 81 00 00 01 00 00 00');
  assert.equal(sent(mbSetDrum('genre', (6 << 16) | 5)), '1 11 00 82 00 00 05 00 06 00'); // genre << 16 | pattern
  assert.equal(sent(mbSetDrum('pattern', 3)), '1 11 00 83 00 00 03 00 00 00');
  assert.equal(sent(mbSetDrum('bpm', 300)), '1 11 00 84 00 00 2C 01 00 00');
  assert.equal(sent(mbSetDrum('follow', 0)), '1 11 00 85 00 00 00 00 00 00');
  assert.equal(sent(mbSetDrum('volume', 100)), '1 11 00 86 00 00 64 00 00 00');
  assert.equal(sent(mbReadDrum()), '0 13 ');
  assert.throws(() => mbSetDrum('bpm', 39), RangeError);
  assert.throws(() => mbSetDrum('volume', 101), RangeError); // the unit would ignore it without an answer
});

test('the drum state reply and the names: 8 genres, 100 patterns in the bank order', () => {
  assert.deepEqual(parseMbDrum(Uint8Array.of(1, 0, 2, 0, 1, 0, 0x64, 0, 0, 50)), { playing: true, genre: 2, pattern: 1, bpm: 100, follow: false, volume: 50 });
  assert.throws(() => parseMbDrum(new Uint8Array(9)));
  assert.equal(MB_DRUM_GENRES.length, 8);
  assert.equal(
    MB_DRUM_GENRES.reduce((n, g) => n + g.count, 0),
    MB_DRUM_PATTERNS.length,
  );
  assert.equal(MB_DRUM_PATTERNS.length, 100);
  assert.equal(mbDrumPatternName(2, 1), 'Funk 2');
  assert.equal(mbDrumPatternName(7, 3), '4/4');
  assert.deepEqual(mbFindDrumRhythm('funk 2'), { genre: 2, pattern: 1 });
  assert.deepEqual(mbFindDrumRhythm('Jazz'), { genre: 3, pattern: 0 }); // a genre: its first pattern
  assert.deepEqual(mbFindDrumRhythm('rock'), { genre: 0, pattern: 0 });
  assert.deepEqual(mbFindDrumRhythm('Metronome'), { genre: 7, pattern: 0 });
  assert.throws(() => mbFindDrumRhythm('polka 9'), /no drum rhythm/);
  assert.match(mbDrumText({ playing: true, genre: 0, pattern: 8, bpm: 100, follow: false, volume: 60 }), /playing · Rock: Hard Rock · 100 BPM · volume 60/);
});

test('mbDrumWith applies a change as the unit does: a new genre starts at its first pattern', () => {
  const s = { playing: false, genre: 2, pattern: 4, bpm: 120, follow: false, volume: 50 };
  assert.deepEqual(mbDrumWith(s, { genre: 0 }), { ...s, genre: 0, pattern: 0 });
  assert.deepEqual(mbDrumWith(s, { pattern: 1, bpm: 90 }), { ...s, pattern: 1, bpm: 90 });
  assert.deepEqual(s.genre, 2); // not mutated
});

test('the drum setting answers are notices: the unit tells its changes with the write shape', () => {
  const notice = (data: number[]) => parseMbNotice({ flag: 1, cmd: 0x11, data: Uint8Array.from(data) });
  assert.deepEqual(notice([0x00, 0x84, 0, 0, 0x64, 0, 0, 0]), { kind: 'drumChange', change: { bpm: 100 } });
  assert.deepEqual(notice([0x00, 0x82, 0, 0, 0x05, 0, 0x06, 0]), { kind: 'drumChange', change: { genre: 6, pattern: 5 } });
  assert.deepEqual(notice([0x00, 0x81, 0, 0, 1, 0, 0, 0]), { kind: 'drumChange', change: { playing: true } });
  assert.deepEqual(notice([0x00, 0x85, 0, 0, 0, 0, 0, 0]), { kind: 'drumChange', change: { follow: false } });
  assert.deepEqual(notice([0x00, 0x86, 0, 0, 30, 0, 0, 0]), { kind: 'drumChange', change: { volume: 30 } });
  const state = parseMbNotice(unwrapMbMessage(wrapMbMessage(0, 0x13, [1, 0, 0, 0, 0, 0, 0x64, 0, 0, 50])));
  assert.equal(state?.kind, 'drum');
});

test('mbWriteDrum starts a rock beat at 100 BPM and reads the state back', async () => {
  const fake = new FakeMatribox();
  const state = await mbWriteDrum(linkTo(fake), { playing: true, ...mbFindDrumRhythm('rock'), bpm: 100, volume: 70 });
  assert.deepEqual(state, { playing: true, genre: 0, pattern: 0, bpm: 100, follow: false, volume: 70 });
  assert.deepEqual(fake.drum, state);
  // The beat is started last, once the rhythm and the tempo are set.
  assert.deepEqual(fake.drumWrites, [0x82, 0x84, 0x86, 0x81]);
});

test('mbWriteDrum: a pattern alone stays in the genre, and the pattern is checked against it', async () => {
  const fake = new FakeMatribox();
  const link = linkTo(fake);
  await mbWriteDrum(link, { genre: 2, pattern: 0 });
  assert.equal((await mbWriteDrum(link, { pattern: 6 })).pattern, 6);
  await assert.rejects(mbWriteDrum(link, { pattern: 7 }), /Funk has 7 patterns/); // Funk has 0..6
  await assert.rejects(mbWriteDrum(link, {}), /nothing to change/);
});

test('mbWriteDrum: playing what already plays sends nothing (the unit would not answer) and resolves', async () => {
  const fake = new FakeMatribox();
  const link = linkTo(fake);
  await mbWriteDrum(link, { playing: true });
  const before = fake.received.length;
  assert.equal((await mbWriteDrum(link, { playing: true })).playing, true);
  assert.equal(fake.received.length, before + 2); // the state read before and after only
});

test('mbWriteDrum says so when the unit keeps another value (BPM while it follows an external clock)', async () => {
  const fake = new FakeMatribox();
  fake.clockSource = 1; // TRS: the unit ignores the drum BPM while it follows the tempo
  const link = linkTo(fake);
  await mbWriteDrum(link, { follow: true });
  await assert.rejects(mbWriteDrum(link, { bpm: 90 }), /kept the drum machine's BPM at 120/);
});

test('mbDrumChangeOf turns a tool request into a change, checked; an own BPM stops the following', () => {
  assert.deepEqual(mbDrumChangeOf({ play: true, rhythm: 'rock', bpm: 100 }), { genre: 0, pattern: 0, playing: true, bpm: 100, follow: false });
  assert.deepEqual(mbDrumChangeOf({ followTempo: true }), { follow: true });
  assert.equal(mbDrumChangeOf({}), null);
  assert.throws(() => mbDrumChangeOf({ bpm: 20 }), /bpm must be an integer 40..300/);
  assert.throws(() => mbDrumChangeOf({ play: 'yes' }), /play must be true or false/);
  assert.throws(() => mbDrumChangeOf({ rhythm: 4 }), /rhythm must be a name/);
});
