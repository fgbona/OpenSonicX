/**
 * A simulated Matribox II Pro: answers the read requests with the replies captured from the owner's
 * unit (packages/core/test/fixtures), paged as the unit pages them, and applies the write frames to
 * an in-memory edit buffer the way docs/matribox.md describes, echoing each write as the unit does
 * (a chain edit is answered with the chain notice instead, and a save with nothing, like the unit).
 * Like the unit, a preset read returns the loaded preset's edit buffer whatever index it names (tagged
 * with that index): only a selected slot reads what it stores.
 * A whole-preset write (flag 2, paged) is stored in the slot it names, like the unit, and answered with cmd 0x17.
 * A user IR upload (flag 1, cmd 0x14, paged) renames its slot in the IR table and is acknowledged
 * with flag 3, cmd 0x14, `slot, 1, 0`, as captures mb-17, mb-17b and mb-17c show. A clone upload (flag 1,
 * cmd 0x18, 49 pages, capture mb-19) does the same in the clone table, acknowledged with flag 3, cmd 0x18;
 * a clone rename (flag 2, cmd 0x18: u32 slot + 20-byte name) renames the slot and is not answered (waveod).
 * Anything else, a clone delete or the bootloader message among them, throws.
 * The global tables answer their argument-less reads (cmd 0x11, 0x16) and follow the global writes
 * (flag 1 cmd 0x11 setting, flag 2 cmd 0x16 EQ value: echoed; flag 1 cmd 0x16 EQ switch: answered
 * `00 00 00 00` + u32, and not at all when it is already so), as captures mb-30 … mb-39 show. Like the
 * unit (zxmarcos/waveod), Global Tempo stays off and its echo says 0 while it has no BPM.
 * Like the unit (zxmarcos/matribox-studio), an insert or model change that would put a third CAB/IR/CLONE
 * block in the chain is refused with the overload notice (cause 2, memory). With `cpuOverload`, one that
 * takes the chain past the DSP (here: core's estimate, mbDspLoad) is applied, then every block is switched
 * off with the overload notice (cause 1) and the on/off notice.
 * Never a real device.
 */
import { readFileSync } from 'node:fs';
import {
  expand,
  fromHex,
  joinMbPages,
  MB_GLOBALS,
  MB_CLONE_SLOTS,
  MB_IR_SLOTS,
  MB_PAGE_SIZE,
  MB_READ,
  MB_BIG_MEMORY_MAX,
  MB_WRITE,
  mbDspLoad,
  mbReadCloneNames,
  mbReadIrNames,
  mbReadPreset,
  mbReadPresetNames,
  type MbGlobalSetting,
  parseMbFrame,
  toHex,
  unwrapMbMessage,
  wrapMbMessage,
} from '../src/index.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').split('\n');
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
const BODY_AT = { 1: 31, 2: 144, 3: 162, 4: 185, 5: 269, 7: 1019, 8: 1122 } as const;
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

/** The general table of the first sessions (docs/matribox.md), with a 0 dB input level. */
const GENERAL = (() => {
  const t = new Uint8Array(52);
  for (const [at, v] of [
    [2, 2],
    [5, 1],
    [9, 1],
    [11, 50],
    [15, 1],
    [20, 1],
    [21, 1],
    [22, 1],
    [35, 1],
    [44, 2],
    [45, 4],
    [48, 0xff],
    [49, 0xff],
  ] as const)
    t[at] = v;
  return t;
})();
/** The global EQ of the first sessions: 31 float32 (head, low cut, bands 1..4, high cut, tail with the level). */
const EQ = [1, 80, 0.71, 0, 20, 0.71, 0, 1, 250, 1, -1, 1, 500, 0.71, 0, 1, 1000, 0.71, 0, 1, 5000, 1, 1, 0, 20000, 0.71, 0, 1, 8000, 0.71, 50];
const EQ_SWITCH = '01000016';
/** Each global setting the unit takes a write of, by its u16 `<index> <id>`. */
const GLOBAL_BY_SUB = new Map(Object.values(MB_GLOBALS).map((d) => [(d.id << 8) | d.index, d] as const));
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];

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
  /** Every clone upload received, decompressed (8872 bytes). */
  readonly cloneUploads: Uint8Array[] = [];
  /** The status the unit answers a clone upload with (1 = stored). */
  cloneStatus = 1;
  /** When set, a whole-preset write to this index is acknowledged but not stored (to test the read-back). */
  dropsPresetWriteTo: number | null = null;
  /** When false the unit stores whole-preset writes but does not acknowledge them. */
  acksPresetWrites = true;
  /** When true a chain past the estimated DSP switches every block off, as the unit's overload guard does. */
  cpuOverload = false;
  /** When true the unit answers the EQ switch without switching it (to test that the answer is checked). */
  ignoresEqSwitch = false;
  #general: Uint8Array = GENERAL;
  #eq: Uint8Array = new Uint8Array(new Float32Array(EQ).buffer);
  #eqOn = true;
  #pages: ReturnType<typeof parseMbFrame>[] = [];
  #irNames = dataOf(this.#replies.get(key(mbReadIrNames()))!);
  #cloneNames = dataOf(this.#replies.get(key(mbReadCloneNames()))!);
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

  /** The general global table (52 bytes) and the global EQ table (124 bytes) as the unit holds them. */
  get globals(): { general: Uint8Array; eq: Uint8Array; eqOn: boolean } {
    return { general: this.#general, eq: this.#eq, eqOn: this.#eqOn };
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
      else if (message.flag === 1 && message.cmd === 0x18) this.#cloneUpload(message.data);
      else this.#wholePreset(message);
      return;
    }
    const message = unwrapMbMessage(frame.payload);
    if (frame.type === MB_WRITE && message.cmd === 0x05) {
      if (!this.dropsSaves) this.#apply(message.cmd, message.data);
      return; // the unit answers a save with nothing
    }
    if (frame.type === MB_WRITE && message.flag === 2 && message.cmd === 0x18) {
      const slot = u32(message.data, 0);
      if (message.data.length !== 24 || slot >= MB_CLONE_SLOTS) throw new Error('fake Matribox: bad clone rename');
      this.#cloneNames = patched(this.#cloneNames, MB_CLONE_SLOTS * 8 + slot * 17, this.#name17(message.data, 4));
      return; // no answer
    }
    if (frame.type === MB_WRITE) {
      const global = this.#globalWrite(message);
      if (global) {
        if (this.echoes && global.length > 0) this.#reply(replyFrames(wrapMbMessage(message.flag, message.cmd, global)));
        return;
      }
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

  /** A 17-byte name field from a 20-byte one at `at`. */
  #name17(data: Uint8Array, at: number): Uint8Array {
    return Uint8Array.from({ length: 17 }, (_, i) => (i < 16 ? (data[at + i] as number) : 0));
  }

  /** u32 slot, u32 0, u32 byte sum of the .clo, 20-byte name, the 8840-byte .clo: the slot takes the name; flag-3 ack. */
  #cloneUpload(data: Uint8Array): void {
    this.#pages = [];
    const slot = u32(data, 0);
    const sum = data.subarray(32).reduce((s, b) => s + b, 0);
    if (data.length !== 8872 || slot >= MB_CLONE_SLOTS || u32(data, 8) !== sum) throw new Error('fake Matribox: bad clone upload');
    this.cloneUploads.push(data);
    if (this.cloneStatus === 1) this.#cloneNames = patched(this.#cloneNames, MB_CLONE_SLOTS * 8 + slot * 17, this.#name17(data, 12));
    if (this.echoes) this.#reply(replyFrames(wrapMbMessage(3, 0x18, [slot, 0, 0, 0, this.cloneStatus, 0, 0, 0, 0, 0, 0, 0])));
  }

  /** Sends a frame on the unit's own (a notice: footswitch, knob), as if used on the unit. */
  emit(frame: Uint8Array): void {
    setImmediate(() => this.#receiver?.(frame));
  }

  /**
   * Something done on the unit itself (`01 00 0A 01` + u32 preset, `02 00 05 01` + slot + on/off…):
   * applied like the host's write, and the notice frame the unit sends for it returned (not sent).
   */
  onUnit(data: ArrayLike<number>): Uint8Array {
    this.#apply(0x10, Uint8Array.from(data));
    return replyFrames(wrapMbMessage(1, 0x10, data))[0] as Uint8Array;
  }

  /** A global setting changed on the unit (`<index> <id> 00 00` + i32): applied, and the notice frame it sends returned. */
  onUnitGlobal(setting: MbGlobalSetting, value: number): Uint8Array {
    const { id, index } = MB_GLOBALS[setting];
    const data = Uint8Array.of(index, id, 0, 0, ...le32(value));
    this.#globalWrite({ flag: 1, cmd: 0x11, data });
    return replyFrames(wrapMbMessage(1, 0x11, data))[0] as Uint8Array;
  }

  /**
   * A global write: what the unit answers (its echo, or the EQ switch's answer; empty for no answer),
   * null when it is not one.
   */
  #globalWrite({ flag, cmd, data }: { flag: number; cmd: number; data: Uint8Array }): Uint8Array | null {
    const setting = data.length === 8 ? GLOBAL_BY_SUB.get((data[0] as number) | ((data[1] as number) << 8)) : undefined;
    if (flag === 1 && cmd === 0x11 && setting) {
      const bpm = (this.#general[48] as number) | ((this.#general[49] as number) << 8);
      const value = setting === MB_GLOBALS.tempoOn && !(bpm >= 40 && bpm <= 300) ? 0 : new DataView(data.buffer, data.byteOffset).getInt32(4, true);
      this.#general = patched(this.#general, setting.at, le32(value).slice(0, setting.wide ? 2 : 1));
      return Uint8Array.from([...data.subarray(0, 4), ...le32(value)]);
    }
    if (flag === 2 && cmd === 0x16 && data.length === 8 && u32(data, 0) < 31) {
      this.#eq = patched(this.#eq, u32(data, 0) * 4, data.subarray(4, 8));
      return data;
    }
    if (flag === 1 && cmd === 0x16 && data.length === 8 && hexOf(data.subarray(0, 4)) === EQ_SWITCH) {
      if ((u32(data, 4) !== 0) === this.#eqOn) return new Uint8Array(0); // already so: the unit answers nothing
      if (!this.ignoresEqSwitch) this.#eqOn = u32(data, 4) !== 0;
      return Uint8Array.of(0, 0, 0, 0, this.#eqOn ? 1 : 0, 0, 0, 0);
    }
    return null;
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
    if (flag === 0 && cmd === 0x18 && arg.length === 0) return answer(this.#cloneNames);
    if (flag === 0 && cmd === 0x11 && arg.length === 0) return answer(this.#general);
    if (flag === 0 && cmd === 0x16 && arg.length === 0) return answer(this.#eq);
    if (flag === 1 && cmd === 0x16 && argHex === EQ_SWITCH) return answer([0, 0, 0, 0, this.#eqOn ? 1 : 0, 0, 0, 0]);
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

  /** The unit's "System overloaded" notice: flag 1, cmd 0x11, `00 07 00 00` + u32 cause (1 DSP, 2 memory). */
  #overload(cause: 1 | 2): void {
    this.emit(replyFrames(wrapMbMessage(1, 0x11, [0x00, 0x07, 0x00, 0x00, cause, 0, 0, 0]))[0] as Uint8Array);
  }

  /** An insert or model change as the unit checks it: refused past the memory, every block off past the DSP. */
  #checkedChain(before: FakeChain, after: FakeChain, focus: number, edit: Uint8Array): Uint8Array {
    const blocks = (c: FakeChain) => c.order.map((slot) => ({ moduleIndex: c.types[slot] as number }));
    const load = mbDspLoad(blocks(after));
    if (load.bigMemory > MB_BIG_MEMORY_MAX && load.bigMemory > mbDspLoad(blocks(before)).bigMemory) {
      this.#overload(2);
      this.#edit = edit; // the new block's values were never loaded
      return this.#setChain(before, NONE);
    }
    const notice = this.#setChain(after, focus);
    if (this.cpuOverload && load.percent > 100) {
      this.#overload(1);
      const off = new Array<number>(SLOTS).fill(0);
      this.#setChain({ ...after, on: off }, NONE);
      this.emit(replyFrames(wrapMbMessage(1, 0x10, [0x07, 0x00, 0x05, 0x01, ...off]))[0] as Uint8Array);
    }
    return notice;
  }

  /** A chain edit; a new model's parameters start at 0 here (the unit loads the model's defaults). */
  #editChain(data: Uint8Array): Uint8Array {
    const before = this.#chain();
    const edit = this.#edit;
    const chain: FakeChain = { order: [...before.order], types: [...before.types], fxids: [...before.fxids], on: [...before.on] };
    const put = (slot: number, type: number, fxid: number) => {
      chain.types[slot] = type;
      chain.fxids[slot] = fxid;
      this.#edit = patched(this.#edit, BODY_AT[5] + 4 + slot * 60, new Uint8Array(60));
    };
    const [op, from, to, type] = [data[0], data[4] as number, data[5] as number, data[6] as number];
    if (op === 0x02) {
      const slot = from; // change model names the storage slot
      put(slot, data[5] as number, u32(data, 6));
      return this.#checkedChain(before, chain, slot, edit);
    }
    if (from === NONE) {
      const slot = chain.types.indexOf(NONE);
      if (slot < 0 || to > chain.order.length) throw new Error('fake Matribox: no room for a block');
      put(slot, type, u32(data, 7));
      chain.on[slot] = 1;
      chain.order.splice(to, 0, slot);
      return this.#checkedChain(before, chain, slot, edit);
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

  // biome-ignore lint/suspicious/noConfusingVoidType: most writes answer nothing; only some return the reply to send
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
    if (head === '01000801') return edit(8, 9 + u32(data, 4) * 12 + u32(data, 8), [u32(data, 12)]); // CTRL row, slot
    // Footswitch function (press / hold) and quick knob (target / parameter), as waveod's firmware
    // takes them (editor/preset_msgs.c): u32 index + u32 value, stored as a byte, echoed as sent.
    if (head === '01000301' || head === '02000301') return edit(3, (head === '01000301' ? 4 : 8) + u32(data, 4), [u32(data, 8) & 0xff]);
    if (head === '01000201' || head === '02000201') return edit(2, (head === '01000201' ? 4 : 7) + u32(data, 4), [u32(data, 8) & 0xff]);
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
