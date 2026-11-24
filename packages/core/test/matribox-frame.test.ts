import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MB_PROBE,
  MB_READ,
  MB_REPLY,
  MB_WRITE,
  buildMbFrame,
  buildMbFrames,
  MB_HOST_PAGE_SIZE,
  float32LE,
  joinMbPages,
  mbChecksum,
  parseMbFrame,
  readFloat32LE,
} from '../src/matribox/frame.ts';
import { fromHex, toHex } from '../src/hex.ts';

const lines = readFileSync(new URL('./fixtures/matribox-capture.txt', import.meta.url), 'utf8').split('\n');
const frames = (dir: string) => lines.filter((l) => l.startsWith(dir)).map((l) => fromHex(l.slice(3)));
const HOST = frames('>>');
const REPLY_PAGES = frames('<<');

test('the probe is the "~GP-2" message the official editor sends first', () => {
  assert.equal(toHex(MB_PROBE), 'F0 21 25 7E 47 50 2D 32 11 12 00 00 00 F7');
});

test('mbChecksum matches every captured host frame', () => {
  assert.equal(HOST.length, 6);
  for (const f of HOST) assert.equal(mbChecksum(f.subarray(13, -1)), f[7], toHex(f.subarray(0, 10)));
});

test('captured host frames parse and rebuild byte for byte', () => {
  for (const f of HOST) {
    const parsed = parseMbFrame(f);
    assert.equal(parsed.checksumOk, true);
    assert.ok(parsed.type === MB_READ || parsed.type === MB_WRITE);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.total, parsed.payload.length);
    assert.equal(toHex(buildMbFrame(parsed.type, parsed.payload)), toHex(f));
  }
});

test('a write frame: type 12, length 28, payload nibble-split high first', () => {
  const f = parseMbFrame(HOST[2] as Uint8Array);
  assert.equal(f.type, MB_WRITE);
  assert.equal(f.total, 28);
  assert.equal(toHex(f.payload.subarray(0, 4)), '01 00 00 10');
});

test('buildMbFrame encodes length and checksum', () => {
  assert.equal(toHex(buildMbFrame(MB_READ, [0xab, 0x01])), 'F0 21 25 4D 50 00 00 16 11 02 00 00 00 0A 0B 00 01 F7');
});

test('buildMbFrame rejects bad types, bytes and payloads longer than one page', () => {
  assert.throws(() => buildMbFrame(MB_REPLY, [1]), /type/);
  assert.throws(() => buildMbFrame(0x13 as typeof MB_READ, [1]), /type/);
  assert.throws(() => buildMbFrame(MB_READ, [256]), /byte/);
  assert.throws(() => buildMbFrame(MB_READ, new Array(186).fill(0)), /page/);
});

test('reply pages carry total length and offset; their checksum is kept, not checked', () => {
  const [first, second] = REPLY_PAGES.map(parseMbFrame) as [ReturnType<typeof parseMbFrame>, ReturnType<typeof parseMbFrame>];
  assert.equal(first.type, MB_REPLY);
  assert.equal(first.total, 346);
  assert.equal(first.offset, 0);
  assert.equal(first.payload.length, 185);
  assert.equal(second.offset, 185);
  assert.equal(second.payload.length, 161);
  assert.equal(first.checksum, (REPLY_PAGES[0] as Uint8Array)[7]);
  assert.equal(first.checksumOk, null);
});

test('parseMbFrame rejects what is not a Matribox frame', () => {
  const good = HOST[0] as Uint8Array;
  assert.throws(() => parseMbFrame(MB_PROBE), /header/);
  assert.throws(() => parseMbFrame(good.subarray(0, -1)), /F7/);
  assert.throws(() => parseMbFrame(fromHex('F0 21 25 4D 50 00 00 00 11 F7')), /short/);
  const odd = Uint8Array.from([...good.subarray(0, -2), 0xf7]);
  assert.throws(() => parseMbFrame(odd), /even/);
  const tooLong = Uint8Array.from(good);
  tooLong[9] = 1; // claims 1 byte, carries 16
  assert.throws(() => parseMbFrame(tooLong), /length/);
  const notNibble = Uint8Array.from(good);
  notNibble[13] = 0x10;
  assert.throws(() => parseMbFrame(notNibble), /nibble/);
});

test('parseMbFrame flags a host frame whose checksum does not match', () => {
  const bad = Uint8Array.from(HOST[0] as Uint8Array);
  bad[7] = (bad[7] as number) ^ 1;
  assert.equal(parseMbFrame(bad).checksumOk, false);
});

test('joinMbPages reassembles the captured 2-page reply in any order', () => {
  const pages = REPLY_PAGES.map(parseMbFrame);
  const joined = joinMbPages(pages);
  assert.ok(joined);
  assert.equal(joined.length, 346);
  assert.match(new TextDecoder('latin1').decode(joined), /Drive AD/);
  assert.deepEqual(joinMbPages([...pages].reverse()), joined);
});

test('joinMbPages returns null until every page is in', () => {
  const pages = REPLY_PAGES.map(parseMbFrame);
  assert.equal(joinMbPages([]), null);
  assert.equal(joinMbPages(pages.slice(0, 1)), null);
  assert.equal(joinMbPages(pages.slice(1)), null);
});

test('joinMbPages rejects pages of different replies or overlapping pages', () => {
  const [a, b] = REPLY_PAGES.map(parseMbFrame) as [ReturnType<typeof parseMbFrame>, ReturnType<typeof parseMbFrame>];
  assert.throws(() => joinMbPages([a, { ...b, total: 999 }]), /different/);
  assert.throws(() => joinMbPages([a, a]), /overlap/);
});

test('float32 little-endian helpers round-trip a knob value', () => {
  assert.equal(toHex(float32LE(64)), '00 00 80 42');
  assert.equal(readFloat32LE(Uint8Array.from([0, 0, 0, 0, 0, 0, 0xc8, 0x42]), 4), 100);
  assert.throws(() => readFloat32LE(new Uint8Array(3), 0), /range/);
});

// Capture mb-20 (the official editor importing a .prst): its host write came as 3 pages. Only the
// frame heads are kept here (the data is a preset we may not publish): length 481 = 0x61 + 3 × 128,
// offsets 0, 183, 366, SysEx sizes 380, 380, 244.
const IMPORT_HEADS = ['F0 21 25 4D 50 00 00 6D 12 61 03 00 00', 'F0 21 25 4D 50 00 00 0C 12 61 03 37 01', 'F0 21 25 4D 50 00 00 0E 12 61 03 6E 02'];

test('buildMbFrames pages a long host message like the official editor: 183 bytes per page', () => {
  const payload = Array.from({ length: 481 }, (_, i) => (i * 7) & 0xff);
  const pages = buildMbFrames(MB_WRITE, payload);
  assert.equal(MB_HOST_PAGE_SIZE, 183);
  assert.deepEqual(pages.map((p) => p.length), [380, 380, 244]);
  assert.deepEqual(pages.map((p) => toHex(p.subarray(8, 13))), IMPORT_HEADS.map((h) => h.slice(-14)));
  const parsed = pages.map(parseMbFrame);
  assert.ok(parsed.every((p) => p.checksumOk === true));
  assert.deepEqual(parsed.map((p) => p.offset), [0, 183, 366]);
  assert.deepEqual(joinMbPages(parsed), Uint8Array.from(payload));
});

test('the host checksum covers the data nibbles only: a page at offset 183 checks out', () => {
  const page = buildMbFrames(MB_WRITE, new Array(300).fill(0x11))[1] as Uint8Array;
  assert.equal(page[7], mbChecksum(page.subarray(13, -1)));
  assert.notEqual(page[7], mbChecksum(page.subarray(10, -1))); // the old reading (from byte 10) fails here
  assert.equal(parseMbFrame(page).checksumOk, true);
});

test('buildMbFrames gives one frame, the same as buildMbFrame, for a short message', () => {
  assert.deepEqual(buildMbFrames(MB_READ, [0xab, 0x01]).map(toHex), [toHex(buildMbFrame(MB_READ, [0xab, 0x01]))]);
  assert.throws(() => buildMbFrames(MB_WRITE, []), /empty/);
});
