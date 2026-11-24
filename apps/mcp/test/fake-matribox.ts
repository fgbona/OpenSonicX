/**
 * A simulated Matribox II Pro: answers the read requests with the replies captured from the owner's
 * unit (packages/core/test/fixtures), paged as the unit pages them. Never a real device.
 */
import { readFileSync } from 'node:fs';
import { expand, fromHex, MB_PAGE_SIZE, mbReadPreset, toHex, wrapMbMessage } from '@pocket-master/core';

const fixture = (name: string) => readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url), 'utf8').split('\n');
const key = (bytes: Uint8Array) => toHex(bytes).replaceAll(' ', '').toLowerCase();

/** Reply frames of a joined message payload: 185-byte pages, type 00 (checksum not checked by anyone). */
export function replyFrames(payload: Uint8Array): Uint8Array[] {
  const total = payload.length;
  return Array.from({ length: Math.ceil(total / MB_PAGE_SIZE) }, (_, i) => {
    const off = i * MB_PAGE_SIZE;
    const page = payload.subarray(off, off + MB_PAGE_SIZE);
    return Uint8Array.from([0xf0, 0x21, 0x25, 0x4d, 0x50, 0x00, 0x00, 0x00, 0x00, total & 0x7f, total >> 7, off & 0x7f, off >> 7, ...expand(page), 0xf7]);
  });
}

function capturedReplies(): Map<string, Uint8Array[]> {
  const replies = new Map<string, Uint8Array[]>();
  const reads = fixture('matribox-reads.txt');
  reads.forEach((line, i) => {
    const next = reads[i + 1] ?? '';
    if (line.startsWith('>>') && next.startsWith('<<')) replies.set(line.slice(3), replyFrames(fromHex(next.slice(3))));
  });
  // The 2-page reply to the current-preset read (argument 0x42), exactly as the unit sent it.
  const capture = fixture('matribox-capture.txt');
  replies.set(key(mbReadPreset(0x42)), capture.filter((l) => l.startsWith('<<')).map((l) => fromHex(l.slice(3))));
  return replies;
}

/** A footswitch-style notification the unit sends on its own (flag 0, cmd 0x11), single page. */
export const NOTIFICATION = replyFrames(wrapMbMessage(0, 0x11, [0x00, 0x52, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]))[0] as Uint8Array;

export class FakeMatribox {
  readonly received: string[] = [];
  #receiver: ((bytes: Uint8Array) => void) | null = null;
  readonly #replies = capturedReplies();
  /** Sent before every reply, to check that unrelated messages are ignored. */
  noise: Uint8Array[] = [NOTIFICATION];

  send(bytes: Uint8Array): void {
    const request = key(bytes);
    this.received.push(request);
    const reply = this.#replies.get(request);
    if (!reply) return; // the unit stays silent on what it does not know
    setImmediate(() => [...this.noise, ...reply].forEach((frame) => this.#receiver?.(frame)));
  }

  listen(receiver: (bytes: Uint8Array) => void): void {
    this.#receiver = receiver;
  }
}
