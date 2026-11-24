/**
 * Requests to a Matribox II Pro over USB MIDI: send one frame, collect the answer's pages, join and
 * decompress them. A read's reply is the message with the request's flag and cmd whose data starts
 * with the request's argument (the unit repeats it); a write is confirmed by the unit's echo, the
 * same flag, cmd and data, except a chain edit (01/02 00 04 01: add, move, remove, change model), which
 * the unit answers with its chain notice (00 00 04 01 + the new chain) instead. The whole-preset
 * write (flag 2, paged) is answered with flag 0, cmd 0x17, `02 00 00 10` (capture mb-20); a user IR
 * upload (flag 1, cmd 0x14, paged) with flag 3, the same cmd, `slot, status, 0`. Anything else
 * the unit sends meanwhile (footswitch and knob notifications) is skipped. One request at a time: the session queues calls.
 */
import { isMbControlChange, joinMbPages, MB_READ, MB_REPLY, MB_WRITE, parseMbFrame, unwrapMbMessage, type MbFrame } from '@pocket-master/core';
import { MATRIBOX, openPedalPorts } from './devices.ts';

export interface MatriboxPorts {
  send(bytes: Uint8Array): void;
  listen(receiver: (bytes: Uint8Array) => void): void;
}

export interface MatriboxConnection {
  /** Sends a read request frame (mbRead…) and resolves with the reply's decompressed data. */
  read(request: Uint8Array): Promise<Uint8Array>;
  /** Sends a write frame (mbSet…, mbSelectPreset, chain edits) and resolves once the unit echoes it. */
  write(frame: Uint8Array): Promise<void>;
  /** Sends the pages of a whole-preset write (mbWritePreset) and resolves once the unit acknowledges it. */
  writePreset(frames: readonly Uint8Array[]): Promise<void>;
  /**
   * Sends the pages of an upload (mbIrUpload: flag 1, cmd 0x14) and resolves with the unit's
   * acknowledgement: flag 3, the same cmd, `u32 slot, u32 status, u32 0` (status 1 = stored).
   */
  upload(frames: readonly Uint8Array[]): Promise<Uint8Array>;
  /** Sends a write frame the unit does not answer (mbSavePreset): check its effect with a read. */
  post(frame: Uint8Array): void;
  /** Sends one MIDI Control Change (mbControlChange: tuner, tempo, looper…); the unit sends no answer. */
  control(message: Uint8Array): void;
  close(): void;
}

export const MATRIBOX_TIMEOUT_MS = 3000;

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const startsWith = (data: Uint8Array, prefix: Uint8Array) => prefix.every((b, i) => data[i] === b);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && startsWith(a, b);
const CHAIN_NOTICE = Uint8Array.of(0x00, 0x00, 0x04, 0x01);
const isChainEdit = (data: Uint8Array) => (data[0] === 0x01 || data[0] === 0x02) && startsWith(data.subarray(1), CHAIN_NOTICE.subarray(1));
/** The unit's answer to a write: its echo, or its chain notice for a chain edit. */
const confirms = (data: Uint8Array, sent: Uint8Array) => equal(data, sent) || (isChainEdit(sent) && startsWith(data, CHAIN_NOTICE));
/** The unit's answer to a whole-preset write: flag 0, cmd 0x17, `02 00 00 10`. */
const PRESET_ACK = { flag: 0, cmd: 0x17, data: Uint8Array.of(0x02, 0x00, 0x00, 0x10) };

function tryParse(bytes: Uint8Array): MbFrame | null {
  try {
    return parseMbFrame(bytes);
  } catch {
    return null; // not a Matribox frame: nothing to do with this read
  }
}

interface Answer {
  readonly flag: number;
  readonly cmd: number;
  readonly accepts: (data: Uint8Array) => boolean;
}

/** The message the host frames carry (one or more pages of type `type`). */
function sentMessage(frames: readonly Uint8Array[], type: number) {
  const pages = frames.map(parseMbFrame);
  if (pages.length === 0 || pages.some((p) => p.type !== type)) throw new Error(`Matribox link: expected frames of type 0x${type.toString(16)}`);
  const joined = joinMbPages(pages);
  if (!joined) throw new Error('Matribox link: the frames do not hold a whole message');
  return unwrapMbMessage(joined);
}

/** The unit acknowledges an upload with this flag (captures mb-17, mb-17b, mb-17c). */
const UPLOAD_ACK_FLAG = 3;

export function matriboxLink(ports: MatriboxPorts, timeoutMs: number = MATRIBOX_TIMEOUT_MS): Pick<MatriboxConnection, 'read' | 'write' | 'writePreset' | 'upload' | 'post' | 'control'> {
  /** Sends `frames` and resolves with the data of the first message `answer` takes. */
  const exchange = (frames: readonly Uint8Array[], answer: Answer, what: string, noAnswer: string): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      let pages: MbFrame[] = [];
      const finish = (error: Error | null, data?: Uint8Array) => {
        clearTimeout(timer);
        ports.listen(() => undefined);
        if (error) reject(error);
        else resolve(data as Uint8Array);
      };
      const timer = setTimeout(() => finish(new Error(`Matribox II PRO did not ${noAnswer} (${what}) within ${timeoutMs} ms. Is it on, and is the official editor closed?`)), timeoutMs);
      const onMessage = (joined: Uint8Array) => {
        if (joined[0] !== answer.flag || joined[3] !== answer.cmd) return;
        let data: Uint8Array;
        try {
          data = unwrapMbMessage(joined).data;
        } catch (error) {
          return finish(new Error(`Matribox II PRO sent a damaged reply (${what}): ${(error as Error).message}`));
        }
        if (answer.accepts(data)) finish(null, data);
      };
      ports.listen((bytes) => {
        const frame = tryParse(bytes);
        if (!frame || frame.type !== MB_REPLY) return;
        if (frame.offset === 0 && frame.payload.length === frame.total) return onMessage(frame.payload); // single page
        // ponytail: one paged message at a time (a new first page restarts it); single-page notifications may interleave.
        pages = frame.offset === 0 ? [frame] : [...pages, frame];
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
      frames.forEach((frame) => ports.send(frame));
    });
  };
  /** The request's own flag and cmd, its data checked by `accepts`. */
  const own = (frames: readonly Uint8Array[], type: number, accepts: (data: Uint8Array, sent: Uint8Array) => boolean, noAnswer: string) => {
    const want = sentMessage(frames, type);
    return exchange(frames, { flag: want.flag, cmd: want.cmd, accepts: (data) => accepts(data, want.data) }, `flag ${want.flag}, cmd ${hex(want.cmd)}`, noAnswer);
  };
  return {
    read: async (request) => own([request], MB_READ, startsWith, 'answer the read'),
    write: async (frame) => void (await own([frame], MB_WRITE, confirms, 'confirm the write')),
    writePreset: async (frames) => {
      const sent = sentMessage(frames, MB_WRITE);
      const ack = { ...PRESET_ACK, accepts: (data: Uint8Array) => equal(data, PRESET_ACK.data) };
      await exchange(frames, ack, `flag ${sent.flag}, cmd ${hex(sent.cmd)}`, 'acknowledge the preset write');
    },
    upload: async (frames) => {
      const sent = sentMessage(frames, MB_WRITE);
      const slot = sent.data.subarray(0, 4);
      const ack = { flag: UPLOAD_ACK_FLAG, cmd: sent.cmd, accepts: (data: Uint8Array) => startsWith(data, slot) };
      return exchange(frames, ack, `flag ${sent.flag}, cmd ${hex(sent.cmd)}`, 'acknowledge the upload');
    },
    post: (frame) => {
      if (parseMbFrame(frame).type !== MB_WRITE) throw new Error('Matribox link: post sends write frames only');
      ports.send(frame);
    },
    control: (message) => {
      if (!isMbControlChange(message)) throw new Error('Matribox link: control sends one Control Change message only');
      ports.send(message);
    },
  };
}

/** Opens the Matribox's USB MIDI ports. The native MIDI library loads on the first call. */
export async function connectMatribox(): Promise<MatriboxConnection> {
  const ports = await openPedalPorts(MATRIBOX);
  return { ...matriboxLink(ports), close: ports.close };
}
