import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lzo1xDecompress, lzo1xLiterals } from '../src/matribox/lzo1x.ts';
import { fromHex, toHex } from '../src/hex.ts';

// Streams made by liblzo2's lzo1x_1_compress from the invented plaintexts below (data, not code).
const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/lzo1x-vectors.json', import.meta.url), 'utf8')) as Record<string, string>;
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const repeat = (s: string, n: number) => ascii(s.repeat(n));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

/** Same pseudo-random bytes as the generator script (an LCG). */
function lcg(n: number, seed: number): Uint8Array {
  let s = seed;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return (s >> 16) & 0xff;
  });
}

const PLAIN: Record<string, Uint8Array> = {
  empty: new Uint8Array(0),
  short: ascii('hello hello hello hello hello world'),
  zeros: new Uint8Array(4096),
  text: repeat('the quick brown fox jumps over the lazy dog. ', 40),
  random: lcg(300, 7),
  far: concat(lcg(300, 7), new Uint8Array(17000), lcg(300, 7)), // a match 17 kB back (M4)
};

test('decompresses every liblzo-made vector byte for byte', () => {
  for (const [name, plain] of Object.entries(PLAIN)) {
    const hex = VECTORS[name];
    assert.ok(hex !== undefined, name);
    assert.deepEqual(lzo1xDecompress(fromHex(hex)), plain, name);
  }
});

test('hand-made streams cover the short matches (M1) after literals', () => {
  // 3 literals "abc" (first byte 17+3), then M1 with state 3: distance 3, length 2, then end.
  assert.equal(toHex(lzo1xDecompress(fromHex('14 61 62 63 08 00 11 00 00'))), '61 62 63 61 62');
  // state 1 after one literal: the M1 copies 2 bytes from distance 1 and then 2 literals.
  assert.equal(toHex(lzo1xDecompress(fromHex('12 41 02 00 42 43 11 00 00'))), '41 41 41 42 43');
});

test('the 3-byte match after a literal run reaches 2049 bytes back', () => {
  const plain = concat(lcg(2049, 1), ascii('xyz'));
  // Long literal run of 2049 bytes: 0x00, then zero bytes (255 each) and a final byte: 3 + 15 + 7*255 + 246 = 2049.
  const literals = concat(fromHex('00 00 00 00 00 00 00 00 F6'), plain.subarray(0, 2049));
  // State 4: 0000DDSS + H, distance = 2049 + (H << 2) + D = 2049, length 3: copies plain[0..3].
  const withMatch = concat(literals, fromHex('00 00 11 00 00'));
  const out = lzo1xDecompress(withMatch);
  assert.equal(out.length, 2052);
  assert.deepEqual(out.subarray(2049), plain.subarray(0, 3));
});

test('lzo1xLiterals makes the literal-only stream the official editor sends', () => {
  assert.equal(toHex(lzo1xLiterals([0x00, 0x00, 0x0a, 0x01])), '15 00 00 0A 01 11 00 00');
  for (const n of [1, 3, 4, 100, 238, 239, 273, 274, 1211, 7444]) {
    const bytes = lcg(n, n);
    assert.deepEqual(lzo1xDecompress(lzo1xLiterals(bytes)), bytes, `n=${n}`);
  }
  // Longer runs: 00, one 00 per 255, then the rest of (n - 18): 239 bytes = 00 DD, 274 = 00 00 01.
  assert.equal(toHex(lzo1xLiterals(new Uint8Array(239)).subarray(0, 2)), '00 DD');
  assert.equal(toHex(lzo1xLiterals(new Uint8Array(274)).subarray(0, 3)), '00 00 01');
  assert.throws(() => lzo1xLiterals([]), /at least 1/);
  assert.throws(() => lzo1xLiterals([256]), /byte/);
});

test('rejects truncated streams', () => {
  const good = fromHex(VECTORS.text as string);
  for (let cut = 0; cut < good.length; cut++) {
    assert.throws(() => lzo1xDecompress(good.subarray(0, cut)), /LZO1X/, `cut at ${cut}`);
  }
});

test('rejects back-references before the start of the output', () => {
  assert.throws(() => lzo1xDecompress(fromHex('12 41 0C 00 11 00 00')), /before the start/);
  assert.throws(() => lzo1xDecompress(fromHex('12 41 21 08 00 11 00 00')), /before the start/); // M3, distance 3
});

test('rejects bytes after the end marker', () => {
  assert.throws(() => lzo1xDecompress(fromHex('15 00 00 0A 01 11 00 00 00')), /after the end/);
});

test('caps the output size', () => {
  const zeros = fromHex(VECTORS.zeros as string);
  assert.equal(lzo1xDecompress(zeros, 4096).length, 4096);
  assert.throws(() => lzo1xDecompress(zeros, 4095), /exceeds 4095/);
  assert.throws(() => lzo1xDecompress(zeros, -1), /maxOut/);
});

test('random garbage and mutated streams throw or decode, never hang', () => {
  let seed = 12345;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed >> 16;
  };
  const sources = Object.values(VECTORS).map(fromHex);
  for (let i = 0; i < 3000; i++) {
    const input = i % 2 === 0
      ? Uint8Array.from({ length: next() % 64 }, () => next() & 0xff)
      : Uint8Array.from(sources[i % sources.length] as Uint8Array);
    if (i % 2 === 1) for (let k = 0; k < 3; k++) input[next() % Math.max(1, input.length)] = next() & 0xff;
    try {
      const out = lzo1xDecompress(input, 65536);
      assert.ok(out.length <= 65536);
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.match(err.message, /LZO1X/);
    }
  }
});
