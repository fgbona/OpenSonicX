import { describeMessage, isReadOnly, isReply, parseFrame, queryFrame, Reassembler, toHex, type Frame, type QueryKind } from '@pocket-master/core';

export interface LogEntry {
  readonly id: number;
  readonly time: number;
  readonly dir: 'TX' | 'RX';
  readonly hex: string;
  readonly note: string;
}

const PORT_HINT = /pocket\s*master/i;
const SYSEX_START = 0xf0;
const REQUEST_TIMEOUT_MS = 1500;
const REQUEST_RETRIES = 2; // USB MIDI occasionally drops a packet of a multi-packet reply

let nextLogId = 0; // module-wide so log keys stay unique across reconnects

export class MidiUnavailableError extends Error {}

/** Asks the browser for MIDI with SysEx. Throws MidiUnavailableError with a user-facing message. */
export async function openMidi(): Promise<MIDIAccess> {
  if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
    throw new MidiUnavailableError('This browser has no Web MIDI. Use Chrome, Edge or Opera on a computer.');
  }
  if (!window.isSecureContext) {
    throw new MidiUnavailableError('Web MIDI needs a secure page. Open the editor over https or on localhost.');
  }
  try {
    return await navigator.requestMIDIAccess({ sysex: true });
  } catch (error) {
    console.error('requestMIDIAccess failed', error);
    throw new MidiUnavailableError(
      'MIDI access was blocked. Allow "MIDI devices" for this site in the browser settings, then try again.',
    );
  }
}

export function pickPocketMaster<T extends MIDIPort>(ports: readonly T[]): T | undefined {
  return ports.find((p) => PORT_HINT.test(p.name ?? ''));
}

/** Read-only link to a Pocket Master: logs every SysEx in both directions and only ever sends GET queries. */
export class PocketMasterLink {
  readonly #input: MIDIInput;
  readonly #output: MIDIOutput;
  readonly #onLog: (entry: LogEntry) => void;
  readonly #assembler = new Reassembler();
  readonly #listeners = new Set<(frame: Frame) => void>();
  constructor(input: MIDIInput, output: MIDIOutput, onLog: (entry: LogEntry) => void) {
    this.#input = input;
    this.#output = output;
    this.#onLog = onLog;
    this.#input.onmidimessage = (event) => this.#receive(event);
  }

  close(): void {
    this.#input.onmidimessage = null;
    this.#listeners.clear();
  }

  /** Sends a query and resolves with the (reassembled) reply. Retries, then rejects with a readable error. */
  async request(kind: QueryKind): Promise<Frame> {
    for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
      const reply = this.#waitFor(kind);
      this.#send(queryFrame(kind));
      const frame = await reply;
      if (frame) return frame;
    }
    throw new Error(`The pedal did not answer query 12 ${kind.toString(16).toUpperCase()} after ${REQUEST_RETRIES + 1} tries.`);
  }

  #send(bytes: Uint8Array): void {
    if (!isReadOnly(bytes)) throw new Error('Blocked: this release only sends read queries to the pedal.');
    this.#log('TX', bytes);
    this.#output.send(bytes);
  }

  #waitFor(kind: QueryKind): Promise<Frame | null> {
    return new Promise((resolve) => {
      const listener = (frame: Frame) => {
        if (!isReply(frame, kind)) return;
        done(frame);
      };
      const timer = setTimeout(() => done(null), REQUEST_TIMEOUT_MS);
      const done = (frame: Frame | null) => {
        clearTimeout(timer);
        this.#listeners.delete(listener);
        resolve(frame);
      };
      this.#listeners.add(listener);
    });
  }

  #receive(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data[0] !== SYSEX_START) return; // only SysEx is logged and decoded
    this.#log('RX', data);
    let frame: Frame;
    try {
      frame = parseFrame(data);
    } catch {
      return; // logged above as "not a Pocket Master frame"
    }
    if (!frame.crcOk) return;
    const complete = this.#assembler.feed(frame, performance.now());
    if (complete) this.#listeners.forEach((listener) => listener(complete));
  }

  #log(dir: LogEntry['dir'], bytes: Uint8Array): void {
    this.#onLog({ id: nextLogId++, time: Date.now(), dir, hex: toHex(bytes), note: describeMessage(bytes) });
  }
}
