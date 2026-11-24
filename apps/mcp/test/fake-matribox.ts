/**
 * A simulated Matribox II Pro: answers the read requests with the replies captured from the owner's
 * unit (packages/core/test/fixtures), paged as the unit pages them, and applies the write frames to
 * an in-memory edit buffer the way docs/matribox.md describes, echoing each write as the unit does
 * (a chain edit is answered with the chain notice instead, and a save with nothing, like the unit).
 * Like the unit, a preset read returns the loaded preset's edit buffer whatever index it names (tagged
 * with that index): only a selected slot reads what it stores.
 * A whole-preset write (flag 2, paged) is stored in the slot it names, like the unit, and answered with cmd 0x17.
 * A user IR upload (flag 1, cmd 0x14, paged) renames its slot in the IR table and is acknowledged
 * with flag 3, cmd 0x14, `slot, 1, 0`, as captures mb-17, mb-17b and mb-17c show.
 * Never a real device.
 */
import { readFileSync } from 'node:fs';
import {
  expand,
  fromHex,
  joinMbPages,
  MB_IR_SLOTS,
  MB_PAGE_SIZE,
  MB_READ,
  MB_WRITE,
  mbReadIrNames,
  mbReadPreset,
  mbReadPresetNames,
  parseMbFrame,
  toHex,
  unwrapMbMessage,
  wrapMbMessage,
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
  replies.set(
    key(mbReadPreset(0x42)),
    CAPTURE.filter((l) => l.startsWith('<<')).map((l) => fromHex(l.slice(3))),
  );
  return replies;
}

/** The decompressed data of a captured reply. */
const dataOf = (frames: readonly Uint8Array[]) => unwrapMbMessage(joinMbPages(frames.map(parseMbFrame)) as Uint8Array).data;

/** Where each section body starts in a 1211-byte device preset (u32 number, then tag + length + body). */
const BODY_AT = { 1: 31, 2: 144, 4: 185, 5: 269, 7: 1019, 8: 1122 } as const;
/** Preset list layout: 4 bytes, 240 u32, then the 17-byte names. */
const NAMES_AT = 4 + 240 * 4;
const SLOTS = 12;

interface FakeChain {
  order: number[];
  types: number[];
  fxids: number[];
  on: number[];
}
const NONE = 0xff;

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
  /** Every MIDI Control Change received (tuner, tempo, looper…), as hex. */
  readonly controls: string[] = [];
  #receiver: ((bytes: Uint8Array) => void) | null = null;
  readonly #replies = capturedReplies();
  /** Sent before every reply, to check that unrelated messages are ignored. */
  noise: Uint8Array[] = [NOTIFICATION];
  /** When false the unit applies writes but sends no echo. */
  echoes = true;
  /** When true the unit drops saves (to test that a save is checked by reading it back). */
  dropsSaves = false;
  /** Every whole-preset write received, decompressed (u32 index + 1207-byte body). */
  readonly presetWrites: Uint8Array[] = [];
  /** Every user IR upload received, decompressed (4128 bytes). */
  readonly irUploads: Uint8Array[] = [];
  /** The status the unit answers an IR upload with (1 = stored). */
  irStatus = 1;
  /** When set, a whole-preset write to this index is acknowledged but not stored (to test the read-back). */
  dropsPresetWriteTo: number | null = null;
  /** When false the unit stores whole-preset writes but does not acknowledge them. */
  acksPresetWrites = true;
  #pages: ReturnType<typeof parseMbFrame>[] = [];
  #irNames = dataOf(this.#replies.get(key(mbReadIrNames()))!);
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
    if (bytes[0] !== 0xf0) {
      this.controls.push(key(bytes)); // a MIDI Control Change: the unit acts on it and answers nothing
      return;
    }
    const request = key(bytes);
    this.received.push(request);
    const frame = parseMbFrame(bytes);
    if (frame.offset > 0 || frame.payload.length < frame.total) {
      this.#pages = frame.offset === 0 ? [frame] : [...this.#pages, frame];
      const joined = joinMbPages(this.#pages);
      if (!joined) return;
      const message = unwrapMbMessage(joined);
      if (message.flag === 1 && message.cmd === 0x14) this.#irUpload(message.data);
      else this.#wholePreset(message);
      return;
    }
    const message = unwrapMbMessage(frame.payload);
    if (frame.type === MB_WRITE && message.cmd === 0x05) {
      if (!this.dropsSaves) this.#apply(message.cmd, message.data);
      return; // the unit answers a save with nothing
    }
    if (frame.type === MB_WRITE) {
      const notice = this.#apply(message.cmd, message.data);
      if (this.echoes) this.#reply(replyFrames(wrapMbMessage(message.flag, message.cmd, notice ?? message.data)));
      return;
    }
    const reply = frame.type === MB_READ ? (this.#read(message.flag, message.cmd, message.data) ?? this.#replies.get(request)) : undefined;
    if (reply) this.#reply(reply); // the unit stays silent on what it does not know
  }

  /** flag 2, cmd 0x10: u32 index + body; the unit keeps it with its own section tags and acknowledges. */
  #wholePreset(message: { flag: number; cmd: number; data: Uint8Array }): void {
    this.#pages = [];
    if (message.flag !== 2 || message.cmd !== 0x10 || message.data.length !== 1211) throw new Error('fake Matribox: unknown paged write');
    this.presetWrites.push(message.data);
    const preset = Uint8Array.from(message.data);
    for (let at = 4, i = 0; i < 9; i++) {
      preset.set([0x00, 0x00, 0x00, 0x10], at);
      at += 8 + u32(preset, at + 4);
    }
    // The unit keeps it in the slot it names (owner's captures mb-20 and midi-123), name included.
    const index = u32(preset, 0);
    if (index !== this.dropsPresetWriteTo) {
      this.#stored = new Map([...this.#stored, [index, preset]]);
      this.#names = patched(this.#names, NAMES_AT + index * 17, preset.subarray(BODY_AT[1] + 8, BODY_AT[1] + 24));
      if (index === this.#current) this.#edit = preset;
    }
    if (this.echoes && this.acksPresetWrites) this.#reply(replyFrames(wrapMbMessage(0, 0x17, [0x02, 0x00, 0x00, 0x10])));
  }

  /** u32 slot, u32 0, u32 checksum, 20-byte name, samples: the slot takes the name; acknowledged with flag 3. */
  #irUpload(data: Uint8Array): void {
    this.#pages = [];
    const slot = u32(data, 0);
    if (data.length !== 4128 || slot >= MB_IR_SLOTS) throw new Error('fake Matribox: bad IR upload');
    this.irUploads.push(data);
    const name = Uint8Array.from({ length: 17 }, (_, i) => (i < 16 ? (data[12 + i] as number) : 0));
    if (this.irStatus === 1) this.#irNames = patched(this.#irNames, MB_IR_SLOTS * 8 + slot * 17, name);
    if (this.echoes) this.#reply(replyFrames(wrapMbMessage(3, 0x14, [slot, 0, 0, 0, this.irStatus, 0, 0, 0, 0, 0, 0, 0])));
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
    if (flag === 0 && cmd === 0x14 && arg.length === 0) return answer(this.#irNames);
    if (flag === 1 && cmd === 0x10 && argHex === '01000a01') return answer([...arg, ...[this.#current, 0, 0, 0]]);
    if (flag === 0 && cmd === 0x10 && arg.length === 4) {
      const number = u32(arg, 0);
      if (number >= 240) return null;
      // The unit's bug (owner's unit, 2026-11-24): any index reads the edit buffer, tagged with that index.
      return answer(patched(this.#edit, 0, arg));
    }
    return null;
  }

  /** The loaded preset's chain: slots in signal order, module index and fxid per slot, on/off per slot. */
  #chain(): FakeChain {
    const e = this.#edit;
    const at = BODY_AT[4];
    return {
      order: [...e.subarray(at + 4, at + 16)].filter((s) => s !== NONE),
      types: [...e.subarray(at + 16, at + 28)],
      fxids: Array.from({ length: SLOTS }, (_, s) => u32(e, at + 28 + s * 4)),
      on: [...e.subarray(BODY_AT[5] + 724, BODY_AT[5] + 736)],
    };
  }

  /** Writes `chain` back and returns the unit's chain notice: 00 00 04 01 + sec4 from byte 4 + on/off + focus. */
  #setChain(chain: FakeChain, focus: number): Uint8Array {
    const order = Array.from({ length: SLOTS }, (_, i) => chain.order[i] ?? NONE);
    const sec4 = [...order, ...chain.types, ...chain.fxids.flatMap((f) => [f & 0xff, (f >>> 8) & 0xff, (f >>> 16) & 0xff, f >>> 24])];
    this.#edit = patched(patched(this.#edit, BODY_AT[4] + 4, sec4), BODY_AT[5] + 724, chain.on);
    return Uint8Array.from([0x00, 0x00, 0x04, 0x01, ...sec4, ...chain.on, focus]);
  }

  /** A chain edit; a new model's parameters start at 0 here (the unit loads the model's defaults). */
  #editChain(data: Uint8Array): Uint8Array {
    const chain = this.#chain();
    const put = (slot: number, type: number, fxid: number) => {
      chain.types[slot] = type;
      chain.fxids[slot] = fxid;
      this.#edit = patched(this.#edit, BODY_AT[5] + 4 + slot * 60, new Uint8Array(60));
    };
    const [op, from, to, type] = [data[0], data[4] as number, data[5] as number, data[6] as number];
    if (op === 0x02) {
      const slot = from; // change model names the storage slot
      put(slot, data[5] as number, u32(data, 6));
      return this.#setChain(chain, slot);
    }
    if (from === NONE) {
      const slot = chain.types.findIndex((t) => t === NONE);
      if (slot < 0 || to > chain.order.length) throw new Error('fake Matribox: no room for a block');
      put(slot, type, u32(data, 7));
      chain.on[slot] = 1;
      chain.order.splice(to, 0, slot);
      return this.#setChain(chain, slot);
    }
    const [slot] = chain.order.splice(from, 1) as [number];
    if (to === NONE) {
      put(slot, NONE, 0);
      chain.on[slot] = 0;
      return this.#setChain(chain, slot);
    }
    chain.order.splice(to, 0, slot);
    return this.#setChain(chain, NONE);
  }

  #apply(cmd: number, data: Uint8Array): Uint8Array | void {
    const head = hexOf(data.subarray(0, 4));
    const edit = (section: keyof typeof BODY_AT, at: number, bytes: ArrayLike<number>) => {
      this.#edit = patched(this.#edit, BODY_AT[section] + at, bytes);
    };
    if (cmd === 0x05) return this.#save(u32(data, 0), data.subarray(4, 21));
    if (cmd !== 0x10) throw new Error(`fake Matribox: unknown write cmd ${cmd}`);
    if (head === '01000501') return edit(5, 4 + u32(data, 4) * 60 + u32(data, 8) * 4, data.subarray(12, 16));
    if (head === '02000501') return edit(5, 724 + u32(data, 4), [u32(data, 8)]);
    if (head === '01000401' || head === '02000401') return this.#editChain(data);
    if (head === '03000501') return edit(5, 736, [data[4] as number, 0]); // patch volume, u16
    if (head === '01000801') return edit(8, 9 + u32(data, 4) * 12 + u32(data, 8), [u32(data, 12)]); // footswitch row, slot
    // Expression (owner's unit, 2026-11-24): u32 group + u32 position address entry group*3+position.
    // An assignment sets the target only; like the unit, the range in it is ignored (0..100) and the
    // echo says so, so the range has to follow with the min/max writes.
    if (head === '02000701') {
      const entry = u32(data, 4) * 3 + u32(data, 8);
      const full = [...new Uint8Array(new Float32Array([0]).buffer), ...new Uint8Array(new Float32Array([100]).buffer)];
      edit(7, 5 + entry, [u32(data, 12)]);
      edit(7, 14 + entry, [u32(data, 16)]);
      edit(7, 23 + entry * 4, full.slice(0, 4));
      edit(7, 59 + entry * 4, full.slice(4, 8));
      return Uint8Array.from([...data.subarray(0, 20), ...full]);
    }
    if (head === '03000701' || head === '04000701') return edit(7, (head === '03000701' ? 23 : 59) + (u32(data, 4) * 3 + u32(data, 8)) * 4, data.subarray(12, 16));
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
