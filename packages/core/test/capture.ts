import { readFileSync } from 'node:fs';
import { fromHex } from '../src/hex.ts';

/** Messages of a capture file: lines "TX|RX <hex>", '#' comments ignored. */
export function readCapture(name: string): { dir: 'TX' | 'RX'; bytes: Uint8Array }[] {
  const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return text
    .split('\n')
    .filter((l) => /^(TX|RX) /.test(l))
    .map((l) => ({ dir: l.slice(0, 2) as 'TX' | 'RX', bytes: fromHex(l.slice(3)) }));
}
