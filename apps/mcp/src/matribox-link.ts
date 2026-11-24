/**
 * Requests to a Matribox II Pro over USB MIDI: send one frame, collect the answer's pages, join and
 * decompress them. A read's reply is the message with the request's flag and cmd whose data starts
 * with the request's argument (the unit repeats it); a write is confirmed by the unit's echo, the
 * same flag, cmd and data, except a chain edit (01/02 00 04 01: add, move, remove, change model), which
 * the unit answers with its chain notice (00 00 04 01 + the new chain) instead. Anything else the unit sends meanwhile (footswitch and knob
 * notifications) is skipped. One request at a time: the session queues calls.
 */
import { joinMbPages, MB_READ, MB_REPLY, MB_WRITE, parseMbFrame, unwrapMbMessage, type MbFrame } from '@pocket-master/core';
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
  /** Sends a write frame the unit does not answer (mbSavePreset): check its effect with a read. */
  post(frame: Uint8Array): void;
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

function tryParse(bytes: Uint8Array): MbFrame | null {
  try {
    return parseMbFrame(bytes);
  } catch {
    return null; // not a Matribox frame: nothing to do with this read
  }
}

export function matriboxLink(ports: MatriboxPorts, timeoutMs: number = MATRIBOX_TIMEOUT_MS): Pick<MatriboxConnection, 'read' | 'write' | 'post'> {
  /** Sends `frame` and resolves with the data of the first message `accepts` takes. */
  const exchange = (frame: Uint8Array, type: number, accepts: (data: Uint8Array, sent: Uint8Array) => boolean, noAnswer: string): Promise<Uint8Array> => {
    const sent = parseMbFrame(frame);
    if (sent.type !== type) throw new Error(`Matribox link: expected a frame of type 0x${type.toString(16)}`);
    const want = unwrapMbMessage(sent.payload);
    const what = `flag ${want.flag}, cmd ${hex(want.cmd)}`;
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
        if (joined[0] !== want.flag || joined[3] !== want.cmd) return;
        let data: Uint8Array;
        try {
          data = unwrapMbMessage(joined).data;
        } catch (error) {
          return finish(new Error(`Matribox II PRO sent a damaged reply (${what}): ${(error as Error).message}`));
        }
        if (accepts(data, want.data)) finish(null, data);
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
      ports.send(frame);
    });
  };
  return {
    read: async (request) => exchange(request, MB_READ, startsWith, 'answer the read'),
    write: async (frame) => void (await exchange(frame, MB_WRITE, confirms, 'confirm the write')),
    post: (frame) => {
      if (parseMbFrame(frame).type !== MB_WRITE) throw new Error('Matribox link: post sends write frames only');
      ports.send(frame);
    },
  };
}

/** Opens the Matribox's USB MIDI ports. The native MIDI library loads on the first call. */
export async function connectMatribox(): Promise<MatriboxConnection> {
  const ports = await openPedalPorts(MATRIBOX);
  return { ...matriboxLink(ports), close: ports.close };
}
