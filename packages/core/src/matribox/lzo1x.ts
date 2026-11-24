/**
 * LZO1X decompression, written for this project from the public description of the format
 * (the Linux kernel's Documentation/staging/lzo.rst). The Matribox II Pro compresses its replies
 * and presets with it. Input comes from a USB device or a downloaded file, so every read, write
 * and back-reference is bounds-checked and the output size is capped.
 *
 * A stream is a list of instructions. After each one, `state` tells how the next small
 * instruction (0..15) reads: 0 = a long literal run, 1..3 = a 2-byte match (M1) after that many
 * literals, 4 = a 3-byte match 2049+ bytes back after a literal run of 4 or more.
 *
 *   0000LLLL           state 0: literal run, 3 + L bytes (L = 0: 18 + 255 × zero bytes + next byte)
 *   0000DDSS H         state 1..3: copy 2 bytes from (H << 2) + D + 1 back
 *   0000DDSS H         state 4: copy 3 bytes from (H << 2) + D + 2049 back
 *   0001HLLL D16       M4: 2 + L bytes (L = 0: extended, base 9), from 16384 + (H << 14) + (D16 >> 2)
 *                      back; distance exactly 16384 = end of stream
 *   001LLLLL D16       M3: 2 + L bytes (L = 0: extended, base 33), from (D16 >> 2) + 1 back
 *   01LDDDSS H         M2: 3 + L bytes from (H << 3) + D + 1 back
 *   1LLDDDSS H         M2: 5 + L bytes from (H << 3) + D + 1 back
 *
 * D16 is a little-endian 16-bit value. After a match, SS (the low 2 bits of the instruction, or of
 * D16) is the number of literals that follow it and the next state. The first byte is special:
 * above 17 it is a literal run of (byte − 17) bytes, leaving state 1..3 or 4.
 */

/** Default output cap: far above anything the unit sends (the largest reply is 7444 bytes). */
export const LZO1X_MAX_OUT = 1 << 20;
/** Longest run lzo1xLiterals encodes with a single first byte (255 − 17). */
const MAX_FIRST_LITERALS = 238;
const END_MARKER = [0x11, 0x00, 0x00] as const;

const fail = (msg: string): never => {
  throw new Error(`LZO1X: ${msg}`);
};

/** Decompresses one complete LZO1X stream. Throws on malformed or truncated input. */
export function lzo1xDecompress(src: Uint8Array, maxOut: number = LZO1X_MAX_OUT): Uint8Array {
  if (!Number.isInteger(maxOut) || maxOut < 0) throw new RangeError(`maxOut must be a non-negative integer, got ${maxOut}`);
  let ip = 0;
  let out = new Uint8Array(Math.min(maxOut, Math.max(64, src.length * 4)));
  let op = 0;

  const byte = (): number => (ip < src.length ? (src[ip++] as number) : fail('input ends in the middle of an instruction'));
  const le16 = (): number => byte() | (byte() << 8);
  /** Length with the zero-byte extension: base + 255 per zero byte + the first non-zero byte. */
  const extended = (base: number): number => {
    let n = base;
    for (let b = byte(); b === 0; b = byte()) n += 255;
    return n + (src[ip - 1] as number);
  };
  const room = (n: number) => {
    if (op + n > maxOut) fail(`output exceeds ${maxOut} bytes`);
    if (op + n <= out.length) return;
    const bigger = new Uint8Array(Math.min(maxOut, Math.max(op + n, out.length * 2)));
    bigger.set(out.subarray(0, op));
    out = bigger;
  };
  const literals = (n: number) => {
    if (ip + n > src.length) fail('input ends in the middle of a literal run');
    room(n);
    out.set(src.subarray(ip, ip + n), op);
    ip += n;
    op += n;
  };
  const match = (distance: number, length: number) => {
    if (distance > op) fail(`match ${distance} bytes back reaches before the start of the output (${op} bytes)`);
    room(length);
    // Byte by byte: the source may overlap what is being written (distance < length).
    for (let i = 0; i < length; i++, op++) out[op] = out[op - distance] as number;
  };

  if (src.length === 0) fail('empty input');
  let state = 0;
  if ((src[0] as number) > 17) {
    const n = byte() - 17;
    literals(n);
    state = n < 4 ? n : 4;
  }
  for (;;) {
    const t = byte();
    let low: number; // the 2 bits that give the next state
    if (t >= 64) {
      const h = byte();
      match((h << 3) + ((t >> 2) & 7) + 1, t >= 128 ? 5 + ((t >> 5) & 3) : 3 + ((t >> 5) & 1));
      low = t & 3;
    } else if (t >= 32) {
      const length = (t & 31) === 0 ? extended(33) : 2 + (t & 31);
      const d = le16();
      match((d >> 2) + 1, length);
      low = d & 3;
    } else if (t >= 16) {
      const length = (t & 7) === 0 ? extended(9) : 2 + (t & 7);
      const d = le16();
      const distance = ((t & 8) << 11) + (d >> 2);
      if (distance === 0) break; // end of stream (16384 back)
      match(distance + 16384, length);
      low = d & 3;
    } else if (state === 0) {
      literals(t === 0 ? extended(18) : 3 + t);
      state = 4;
      continue;
    } else {
      const h = byte();
      match((h << 2) + (t >> 2) + (state === 4 ? 2049 : 1), state === 4 ? 3 : 2);
      low = t & 3;
    }
    literals(low);
    state = low;
  }
  if (ip !== src.length) fail(`${src.length - ip} bytes after the end of the stream`);
  return out.slice(0, op);
}

/**
 * A valid LZO1X stream that stores `bytes` as one literal run (no compression). This is what the
 * official editor sends in its small read requests.
 */
export function lzo1xLiterals(bytes: ArrayLike<number>): Uint8Array {
  const data = Array.from(bytes);
  // ponytail: one first-byte run only; longer data needs a real compressor, add one with a use for it.
  if (data.length < 1 || data.length > MAX_FIRST_LITERALS) fail(`literal-only stream holds 1..${MAX_FIRST_LITERALS} bytes, got ${data.length}`);
  if (data.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) fail('literals must be byte values 0..255');
  return Uint8Array.from([17 + data.length, ...data, ...END_MARKER]);
}
