/**
 * A simulated Matribox II Pro: answers the read requests with the replies captured from the owner's
 * unit (packages/core/test/fixtures), paged as the unit pages them, and applies the write frames to
 * an in-memory edit buffer the way docs/matribox.md describes, echoing each write as the unit does.
 * Never a real device.
 */
import { readFileSync } from 'node:fs';
import {
  expand, fromHex, joinMbPages, MB_PAGE_SIZE, MB_READ, MB_WRITE, mbReadPreset, mbReadPresetNames, parseMbFrame, toHex, unwrapMbMessage, wrapMbMessage,
} from '@pocket-master/core';

const fixture = (name: string) => readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url), 'utf8').split('\n');
const key = (bytes: Uint8Array) => toHex(bytes).replaceAll(' ', '').toLowerCase();
const u32 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true);
const hexOf = (bytes: ArrayLike<number>) => key(Uint8Array.from(bytes));

/** Reply frames of a joined message payload: 185-byte pages, type 00 (checksum not checked by anyone). */
export function replyFrames(payload: Uint8Array): Uint8Array[] {
  const total = payload.length;
  return Array.from({ length: Math.ceil(total / MB_PAGE_SIZE) }, (_, i) => {
    const off = i * MB_PAGE_SIZE;
    const page = payload.subarray(off, off + MB_PAGE_SIZE);
    return Uint8Array.from([0xf0, 0x21, 0x25, 0x4d, 0x50, 0x00, 0x00, 0x00, 0x00, total & 0x7f, total >> 7, off & 0x7f, off >> 7, ...expand(page), 0xf7]);
  });
}

const CAPTURE = fixture('matribox-capture.txt');
const READS = fixture('matribox-reads.txt');

function capturedReplies(): Map<string, Uint8Array[]> {
  const replies = new Map<string, Uint8Array[]>();
  READS.forEach((line, i) => {
    const next = READS[i + 1] ?? '';
    if (line.startsWith('>>') && next.startsWith('<<')) replies.set(line.slice(3), replyFrames(fromHex(next.slice(3))));
  });
  // The 2-page reply to the current-preset read (argument 0x42), exactly as the unit sent it.
  replies.set(key(mbReadPreset(0x42)), CAPTURE.filter((l) => l.startsWith('<<')).map((l) => fromHex(l.slice(3))));
  return replies;
}

/** The decompressed data of a captured reply. */
const dataOf = (frames: readonly Uint8Array[]) => unwrapMbMessage(joinMbPages(frames.map(parseMbFrame)) as Uint8Array).data;

/** Where each section body starts in a 1211-byte device preset (u32 number, then tag + length + body). */
const BODY_AT = { 1: 31, 2: 144, 4: 185, 5: 269, 7: 1019, 8: 1122 } as const;
/** Preset list layout: 4 bytes, 240 u32, then the 17-byte names. */
const NAMES_AT = 4 + 240 * 4;

/** A copy of `data` with `bytes` written at `at`. */
function patched(data: Uint8Array, at: number, bytes: ArrayLike<number>): Uint8Array {
  const out = Uint8Array.from(data);
  out.set(Array.from(bytes), at);
  return out;
}

/** A footswitch-style notification the unit sends on its own (flag 0, cmd 0x11), single page. */
export const NOTIFICATION = replyFrames(wrapMbMessage(0, 0x11, [0x00, 0x52, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]))[0] as Uint8Array;

export class FakeMatribox {
  readonly received: string[] = [];
  #receiver: ((bytes: Uint8Array) => void) | null = null;
  readonly #replies = capturedReplies();
  /** Sent before every reply, to check that unrelated messages are ignored. */
  noise: Uint8Array[] = [NOTIFICATION];
  /** When false the unit applies writes but sends no echo. */
  echoes = true;
  #names = dataOf(this.#replies.get(key(mbReadPresetNames()))!);
  #current = 0x42;
  /** Stored presets by number (1211 bytes, number first). */
  #stored = new Map<number, Uint8Array>([[0x42, dataOf(this.#replies.get(key(mbReadPreset(0x42)))!)]]);
  /** What an unsaved slot holds here: the captured preset without a name. */
  readonly #blank = patched(this.#stored.get(0x42) as Uint8Array, BODY_AT[1] + 8, new Uint8Array(16));
  /** The loaded preset as the unit plays it (edits not saved). */
  #edit = this.#stored.get(0x42) as Uint8Array;

  get current(): number {
    return this.#current;
  }

  /** The loaded preset, decompressed (1211 bytes). */
  get editBuffer(): Uint8Array {
    return this.#edit;
  }

  stored(index: number): Uint8Array | undefined {
    return this.#stored.get(index);
  }

  send(bytes: Uint8Array): void {
    const request = key(bytes);
    this.received.push(request);
    const frame = parseMbFrame(bytes);
    const message = unwrapMbMessage(frame.payload);
    if (frame.type === MB_WRITE) {
      this.#apply(message.cmd, message.data);
      if (this.echoes) this.#reply(replyFrames(wrapMbMessage(message.flag, message.cmd, message.data)));
      return;
    }
    const reply = frame.type === MB_READ ? this.#read(message.flag, message.cmd, message.data) ?? this.#replies.get(request) : undefined;
    if (reply) this.#reply(reply); // the unit stays silent on what it does not know
  }

  listen(receiver: (bytes: Uint8Array) => void): void {
    this.#receiver = receiver;
  }

  #reply(frames: readonly Uint8Array[]): void {
    setImmediate(() => [...this.noise, ...frames].forEach((f) => this.#receiver?.(f)));
  }

  /** Reads whose answer follows the writes; null for the rest (captured replies). */
  #read(flag: number, cmd: number, arg: Uint8Array): Uint8Array[] | null {
    const answer = (data: ArrayLike<number>) => replyFrames(wrapMbMessage(flag, cmd, data));
    const argHex = hexOf(arg);
    if (flag === 1 && cmd === 0x10 && argHex === '00000a01') return answer(this.#names);
    if (flag === 1 && cmd === 0x10 && argHex === '01000a01') return answer([...arg, ...[this.#current, 0, 0, 0]]);
    if (flag === 0 && cmd === 0x10 && arg.length === 4) {
      const number = u32(arg, 0);
      if (number >= 240) return null;
      return answer(patched(number === this.#current ? this.#edit : this.#stored.get(number) ?? this.#blank, 0, arg));
    }
    return null;
  }

  #apply(cmd: number, data: Uint8Array): void {
    const head = hexOf(data.subarray(0, 4));
    const edit = (section: keyof typeof BODY_AT, at: number, bytes: ArrayLike<number>) => {
      this.#edit = patched(this.#edit, BODY_AT[section] + at, bytes);
    };
    if (cmd === 0x05) return this.#save(u32(data, 0), data.subarray(4, 21));
    if (cmd !== 0x10) throw new Error(`fake Matribox: unknown write cmd ${cmd}`);
    if (head === '01000501') return edit(5, 4 + u32(data, 4) * 60 + u32(data, 8) * 4, data.subarray(12, 16));
    if (head === '02000501') return edit(5, 724 + u32(data, 4), [u32(data, 8)]);
    if (head === '00000401') {
      edit(4, 4, data.subarray(4, 76));
      return edit(5, 724, data.subarray(76, 88));
    }
    if (head === '04000401') {
      edit(2, 4, data.subarray(4, 10));
      edit(7, 5, data.subarray(10, 100));
      return edit(8, 9, data.subarray(100, 160));
    }
    if (head === '01000a01') {
      this.#current = u32(data, 4);
      this.#edit = this.#stored.get(this.#current) ?? this.#blank;
      return;
    }
    throw new Error(`fake Matribox: unknown write ${head}`);
  }

  #save(index: number, name: Uint8Array): void {
    this.#names = patched(this.#names, NAMES_AT + index * 17, name);
    const saved = patched(patched(this.#edit, BODY_AT[1] + 8, name.subarray(0, 16)), 0, [index, 0, 0, 0]);
    this.#stored = new Map([...this.#stored, [index, saved]]);
    if (index === this.#current) this.#edit = saved;
  }
}
