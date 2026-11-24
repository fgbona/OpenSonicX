/**
 * Read requests to a Matribox II Pro over USB MIDI: send one request frame, collect the reply's pages,
 * join and decompress them. The reply is the message with the request's flag and cmd whose data
 * starts with the request's argument (the unit repeats it); anything else the unit sends meanwhile
 * (footswitch and knob notifications) is skipped. One request at a time: the session queues calls.
 */
import { joinMbPages, MB_READ, MB_REPLY, parseMbFrame, unwrapMbMessage, type MbFrame } from '@pocket-master/core';
import { MATRIBOX, openPedalPorts } from './devices.ts';

export interface MatriboxPorts {
  send(bytes: Uint8Array): void;
  listen(receiver: (bytes: Uint8Array) => void): void;
}

export interface MatriboxConnection {
  /** Sends a read request frame (mbRead…) and resolves with the reply's decompressed data. */
  read(request: Uint8Array): Promise<Uint8Array>;
  close(): void;
}

export const MATRIBOX_TIMEOUT_MS = 3000;

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const startsWith = (data: Uint8Array, prefix: Uint8Array) => prefix.every((b, i) => data[i] === b);

function tryParse(bytes: Uint8Array): MbFrame | null {
  try {
    return parseMbFrame(bytes);
  } catch {
    return null; // not a Matribox frame: nothing to do with this read
  }
}

export function matriboxLink(ports: MatriboxPorts, timeoutMs: number = MATRIBOX_TIMEOUT_MS): Pick<MatriboxConnection, 'read'> {
  const read = async (request: Uint8Array): Promise<Uint8Array> => {
    const sent = parseMbFrame(request);
    if (sent.type !== MB_READ) throw new Error('Matribox link: only read requests are sent');
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
      const timer = setTimeout(() => finish(new Error(`Matribox II PRO did not answer the read (${what}) within ${timeoutMs} ms. Is it on, and is the official editor closed?`)), timeoutMs);
      const onMessage = (joined: Uint8Array) => {
        if (joined[0] !== want.flag || joined[3] !== want.cmd) return;
        let data: Uint8Array;
        try {
          data = unwrapMbMessage(joined).data;
        } catch (error) {
          return finish(new Error(`Matribox II PRO sent a damaged reply (${what}): ${(error as Error).message}`));
        }
        if (startsWith(data, want.data)) finish(null, data);
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
      ports.send(request);
    });
  };
  return { read };
}

/** Opens the Matribox's USB MIDI ports. The native MIDI library loads on the first call. */
export async function connectMatribox(): Promise<MatriboxConnection> {
  const ports = await openPedalPorts(MATRIBOX);
  return { ...matriboxLink(ports), close: ports.close };
}
