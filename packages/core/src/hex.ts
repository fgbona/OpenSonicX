/** Uppercase, space separated: `F0 00 07 F7`. */
export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** Parses hex with or without spaces. Throws on odd length or non-hex characters. */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error(`invalid hex string: "${text.slice(0, 40)}"`);
  }
  return Uint8Array.from({ length: clean.length / 2 }, (_, i) => parseInt(clean.slice(2 * i, 2 * i + 2), 16));
}
