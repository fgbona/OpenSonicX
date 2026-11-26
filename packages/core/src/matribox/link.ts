/**
 * Requests to a Matribox II Pro over any MIDI port (Web MIDI, Node): send one frame, collect the
 * answer's pages, join and decompress them. A read's reply is the message with the request's flag
 * and cmd whose data starts with the request's argument (the unit repeats it); a write is confirmed
 * by the unit's echo (same flag, cmd and data; a set param or on/off by the echo of its slot and
 * parameter, which carries the value the unit kept), except a chain edit (01/02 00 04 01: add, move,
 * remove, change model), which the unit answers with its chain notice (00 00 04 01 + the new chain).
 * The whole-preset write (flag 2, paged: mbWritePreset) is answered with flag 0, cmd 0x17,
 * `02 00 00 10` (capture mb-20); a user IR or clone upload (flag 1, cmd 0x14 / 0x18, paged: mbIrUpload, mbCloneUpload) with
 * flag 3, the same cmd, `slot, status, 0`. A save gets no answer: send it with post and check it by reading the slot back. A MIDI Control
 * Change (control) gets none either. Anything else
 * the unit sends meanwhile, or while no request runs, goes to the `onNotice` handler when it is a
 * notice the unit sends on its own (parseMbNotice: preset change, block toggle, knob turn…).
 * One request at a time: callers queue their calls.
 *
 * The unit holds back a knob's notices while it turns (stock FUN_0003568C, reimplemented in
 * zxmarcos/waveod src/editor/server.c, MIT): the same notice again is held, the newest kept, and
 * sent only after 150 ms without one or once 10 are held; mb-42 got a gain knob 0.4 s and 3..4
 * steps apart. Any other notice the unit sends lets the held one out first, and the answer to a
 * preset-tempo read is one: while knob notices come (knobs 1..3: param and volume), the link sends
 * that read every `flushMs` (0: never), until `FLUSH_QUIET_POLLS` reads bring none. Its answer is
 * no notice, so it differs from every knob's (a patch-volume read could not let knob 3's out) and
 * reaches no one. The read goes only between requests.
 */
import type { MidiPort } from '../link.ts';
import { joinMbPages, MB_READ, MB_REPLY, MB_WRITE, parseMbFrame, type MbFrame } from './frame.ts';
import { mbReadPresetTempo, unwrapMbMessage } from './message.ts';
import { mbParamEchoId } from './write.ts';
import { isMbControlChange } from './cc.ts';
import { parseMbNotice, type MbNotice } from './notice.ts';

export interface MatriboxLink {
  /** Sends a read request frame (mbRead…) and resolves with the reply's decompressed data. */
  read(request: Uint8Array): Promise<Uint8Array>;
  /** Sends a write frame (mbSet…, mbSelectPreset, chain edits) and resolves once the unit confirms it. */
  write(frame: Uint8Array): Promise<void>;
  /** Sends the pages of a whole-preset write (mbWritePreset) and resolves once the unit acknowledges it. */
  writePreset(frames: readonly Uint8Array[]): Promise<void>;
  /**
   * Sends the pages of an upload (mbIrUpload: flag 1, cmd 0x14) and resolves with the unit's
   * acknowledgement: flag 3, the same cmd, `u32 slot, u32 status, u32 0` (status 1 = stored).
   * `timeoutMs` overrides the link's for this upload (a clone capture takes the unit longer to store).
   */
  upload(frames: readonly Uint8Array[], timeoutMs?: number): Promise<Uint8Array>;
  /**
   * Sends a read or write frame whose answer does not repeat it, and resolves with the data of the
   * first message of its flag and cmd that `accepts` takes: the argument-less global tables (told
   * apart by length) and the global EQ switch (answered `00 00 00 00` + u32; globals.ts).
   */
  ask(frame: Uint8Array, accepts: (data: Uint8Array) => boolean): Promise<Uint8Array>;
  /** Sends a write frame the unit does not answer (mbSavePreset): check its effect with a read. */
  post(frame: Uint8Array): void;
  /** Sends one MIDI Control Change (mbControlChange; tuner, tempo, looper…): the unit sends no answer. */
  control(message: Uint8Array): void;
  /**
   * Hands every notice the unit sends on its own (not an answer to a request) to `handler`; null
   * stops. While set, the link keeps listening on the port between requests.
   */
  onNotice(handler: ((notice: MbNotice) => void) | null): void;
}

export const MATRIBOX_TIMEOUT_MS = 3000;
/** How often the link lets out a knob notice the unit holds (about the official editor's own write rate, mb-01). */
export const MATRIBOX_FLUSH_MS = 50;
/** Reads with no knob notice in between before the link stops (the knob stopped). */
const FLUSH_QUIET_POLLS = 10;

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const startsWith = (data: Uint8Array, prefix: Uint8Array) => prefix.every((b, i) => data[i] === b);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && startsWith(a, b);
const CHAIN_NOTICE = Uint8Array.of(0x00, 0x00, 0x04, 0x01);
const isChainEdit = (data: Uint8Array) => (data[0] === 0x01 || data[0] === 0x02) && startsWith(data.subarray(1), CHAIN_NOTICE.subarray(1));
const SET_PARAM = Uint8Array.of(0x01, 0x00, 0x05, 0x01);
const SET_ON = Uint8Array.of(0x02, 0x00, 0x05, 0x01);
/**
 * A set param (`01 00 05 01` + slot + order + f32) or on/off (`02 00 05 01` + slot + u32): the unit
 * echoes the value it kept (snapped to the step, clamped to the range), so the echo names the same
 * slot (and parameter) but may carry another value; the caller reads the preset back for the value.
 * A set param's echo names the widget ID, not the order the frame carries (mbSetParam, mbParamEchoId).
 */
const sameTarget = (data: Uint8Array, sent: Uint8Array, echoId: number | undefined) => {
  if (data.length !== sent.length) return false;
  if (startsWith(sent, SET_ON)) return startsWith(data, sent.subarray(0, 8));
  return startsWith(sent, SET_PARAM) && startsWith(data, sent.subarray(0, 8)) && u32At(data, 8) === (echoId ?? u32At(sent, 8));
};
const u32At = (b: Uint8Array, at: number) => ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0;
/** The unit's answer to a write: its echo, or its chain notice for a chain edit. */
const confirms = (data: Uint8Array, sent: Uint8Array, echoId?: number) => equal(data, sent) || sameTarget(data, sent, echoId) || (isChainEdit(sent) && startsWith(data, CHAIN_NOTICE));
/**
 * The echo of a set param that names the slot but another parameter: the unit took the write for a
 * parameter the model does not have (mb-46: it echoed ID 0). That parameter id, or null.
 */
const otherParam = (data: Uint8Array, sent: Uint8Array, echoId: number | undefined): number | null =>
  startsWith(sent, SET_PARAM) && data.length === sent.length && startsWith(data, sent.subarray(0, 8)) && !sameTarget(data, sent, echoId) ? u32At(data, 8) : null;
/** Messages from the unit kept for a failed exchange's log. */
const HEARD_KEPT = 10;
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
/** The unit's answer to a whole-preset write: flag 0, cmd 0x17, `02 00 00 10`. */
const PRESET_ACK = { flag: 0, cmd: 0x17, data: Uint8Array.of(0x02, 0x00, 0x00, 0x10) };
/** The unit acknowledges an upload with this flag (captures mb-17, mb-17b, mb-17c). */
const UPLOAD_ACK_FLAG = 3;

interface Answer {
  readonly flag: number;
  readonly cmd: number;
  readonly accepts: (data: Uint8Array) => boolean;
  /** Why an answer of the flag and cmd that `accepts` refused is a refusal of the request; null when it is not. */
  readonly refuses?: (data: Uint8Array) => string | null;
}

/** The message the host frames carry (one or more pages of type `type`). */
function sentMessage(frames: readonly Uint8Array[], type: number) {
  const pages = frames.map(parseMbFrame);
  if (pages.length === 0 || pages.some((p) => p.type !== type)) throw new Error(`Matribox link: expected a frame of type 0x${type.toString(16)}`);
  const joined = joinMbPages(pages);
  if (!joined) throw new Error('Matribox link: the frames do not hold a whole message');
  return unwrapMbMessage(joined);
}

function tryParse(bytes: Uint8Array): MbFrame | null {
  try {
    return parseMbFrame(bytes);
  } catch {
    return null; // not a Matribox frame: nothing to do with this request
  }
}

export function matriboxLink(port: MidiPort, timeoutMs: number = MATRIBOX_TIMEOUT_MS, flushMs: number = MATRIBOX_FLUSH_MS): MatriboxLink {
  let noticeHandler: ((notice: MbNotice) => void) | null = null;
  let exchanging = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let quietPolls = 0;
  const stopFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  };
  const flush = () => {
    flushTimer = null;
    if (!noticeHandler || quietPolls-- <= 0) return;
    flushTimer = setTimeout(flush, flushMs); // first: the answer can bring a knob notice (knobTurning) at once
    // Only between requests: a request's answer lets the held notice out anyway, and extra traffic
    // while a write waits for its echo only adds to the unit's queue.
    if (!exchanging) port.send(mbReadPresetTempo());
  };
  /** A knob notice came: keep letting the next ones out until the knob stops. */
  const knobTurning = () => {
    if (flushMs <= 0) return;
    quietPolls = FLUSH_QUIET_POLLS;
    flushTimer ??= setTimeout(flush, flushMs);
  };
  /** A message no request took: a notice for the handler, or nothing. */
  const toNotice = (joined: Uint8Array) => {
    if (!noticeHandler) return;
    let notice: MbNotice | null;
    try {
      notice = parseMbNotice(unwrapMbMessage(joined));
    } catch {
      return; // ponytail: a damaged message nobody asked for is dropped; the next read shows the truth
    }
    if (!notice) return;
    if (notice.kind === 'param' || notice.kind === 'volume') knobTurning();
    noticeHandler(notice);
  };
  /** Between requests: the unit's notices are single-page messages. */
  const idle = (bytes: Uint8Array) => {
    const page = tryParse(bytes);
    if (page && page.type === MB_REPLY && page.offset === 0 && page.payload.length === page.total) toNotice(page.payload);
  };
  const listenIdle = () => port.listen(noticeHandler ? idle : null);
  /** Sends `frames` and resolves with the data of the first message `answer` takes. */
  const exchange = async (frames: readonly Uint8Array[], answer: Answer, what: string, noAnswer: string, wait: number = timeoutMs): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      let pages: MbFrame[] = [];
      /** The unit's last messages, for the log of a failed exchange. */
      let heard: string[] = [];
      exchanging = true;
      const finish = (error: Error | null, data?: Uint8Array) => {
        clearTimeout(timer);
        exchanging = false;
        listenIdle();
        if (error) reject(error);
        else resolve(data as Uint8Array);
      };
      const failed = (message: string) => {
        console.error(`Matribox: ${message}\nsent: ${frames.map(hexOf).join(' | ')}\nheard (last ${HEARD_KEPT}, decompressed):\n${heard.join('\n') || '(nothing)'}`);
        finish(new Error(message));
      };
      const timer = setTimeout(() => failed(`Matribox II PRO did not ${noAnswer} (${what}) within ${wait} ms. Is it on, and is the official editor closed?`), wait);
      const onMessage = (joined: Uint8Array) => {
        try {
          const m = unwrapMbMessage(joined);
          heard = [...heard, `flag ${m.flag} cmd ${hex(m.cmd)}: ${hexOf(m.data)}`].slice(-HEARD_KEPT);
        } catch {
          heard = [...heard, `damaged: ${hexOf(joined)}`].slice(-HEARD_KEPT);
        }
        if (joined[0] !== answer.flag || joined[3] !== answer.cmd) return toNotice(joined);
        let data: Uint8Array;
        try {
          data = unwrapMbMessage(joined).data;
        } catch (error) {
          return finish(new Error(`Matribox II PRO sent a damaged reply (${what}): ${(error as Error).message}`));
        }
        if (answer.accepts(data)) return finish(null, data);
        const refused = answer.refuses?.(data);
        if (refused) return failed(refused);
        toNotice(joined);
      };
      port.listen((bytes) => {
        const page = tryParse(bytes);
        if (!page || page.type !== MB_REPLY) return;
        if (page.offset === 0 && page.payload.length === page.total) return onMessage(page.payload); // single page
        // ponytail: one paged message at a time (a new first page restarts it); single-page notifications may interleave.
        pages = page.offset === 0 ? [page] : [...pages, page];
        let joined: Uint8Array | null;
        try {
          joined = joinMbPages(pages);
        } catch {
          pages = [];
          return;
        }
        if (joined) {
          pages = [];
          onMessage(joined);
        }
      });
      frames.forEach((frame) => port.send(frame));
    });
  };
  /** The request's own flag and cmd, its data checked by `accepts`. */
  const own = async (frame: Uint8Array, type: number, accepts: (data: Uint8Array, sent: Uint8Array) => boolean, noAnswer: string, refuses?: (data: Uint8Array, sent: Uint8Array) => string | null) => {
    const want = sentMessage([frame], type);
    const answer: Answer = { flag: want.flag, cmd: want.cmd, accepts: (data) => accepts(data, want.data), refuses: refuses && ((data) => refuses(data, want.data)) };
    return exchange([frame], answer, `flag ${want.flag}, cmd ${hex(want.cmd)}`, noAnswer);
  };
  return {
    read: (request) => own(request, MB_READ, startsWith, 'answer the read'),
    write: async (frame) => {
      const echoId = mbParamEchoId(frame);
      const refuses = (data: Uint8Array, sent: Uint8Array) => {
        const got = otherParam(data, sent, echoId);
        return got === null ? null : `Matribox II PRO took the write for parameter ${got} instead of ${echoId ?? u32At(sent, 8)} (slot ${u32At(sent, 4)}): the block's model has no such parameter.`;
      };
      await own(frame, MB_WRITE, (data, sent) => confirms(data, sent, echoId), 'confirm the write', refuses);
    },
    writePreset: async (frames) => {
      const sent = sentMessage(frames, MB_WRITE);
      const ack = { ...PRESET_ACK, accepts: (data: Uint8Array) => equal(data, PRESET_ACK.data) };
      await exchange(frames, ack, `flag ${sent.flag}, cmd ${hex(sent.cmd)}`, 'acknowledge the preset write');
    },
    upload: async (frames, wait) => {
      const sent = sentMessage(frames, MB_WRITE);
      const slot = sent.data.subarray(0, 4);
      const ack = { flag: UPLOAD_ACK_FLAG, cmd: sent.cmd, accepts: (data: Uint8Array) => startsWith(data, slot) };
      return exchange(frames, ack, `flag ${sent.flag}, cmd ${hex(sent.cmd)}`, 'acknowledge the upload', wait);
    },
    ask: (frame, accepts) => own(frame, parseMbFrame(frame).type, (data) => accepts(data), 'answer'),
    post: (frame) => {
      if (parseMbFrame(frame).type !== MB_WRITE) throw new Error('Matribox link: post sends write frames only');
      port.send(frame);
    },
    control: (message) => {
      if (!isMbControlChange(message)) throw new Error('Matribox link: control sends one Control Change message only');
      port.send(message);
    },
    onNotice: (handler) => {
      noticeHandler = handler;
      if (!handler) stopFlush();
      if (!exchanging) listenIdle();
    },
  };
}
