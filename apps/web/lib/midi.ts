import { decodeAck, describeMessage, editKey, isAllowedEdit, isPresetOperation, isReadOnly, PresetCommand, isReply, parseFrame, queryFrame, Reassembler, toHex, type Frame, type QueryKind } from '@pocket-master/core';

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
/** Spacing between edit messages so a slider drag cannot flood the pedal. */
export const EDIT_GAP_MS = 20;
/** The pedal acknowledges a save within this time or the save counts as failed. */
const ACK_TIMEOUT_MS = 3000;
const ACK = { TYPE: 0x14, COMMAND: 0x08 } as const;

let nextLogId = 0; // module-wide so log keys stay unique across reconnects

export class MidiUnavailableError extends Error {}

/** Thrown by a request that was pending, or started, after the link was closed. */
export class LinkClosedError extends Error {
  constructor() {
    super('The connection to the pedal was closed.');
  }
}

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

/**
 * Link to a Pocket Master. Logs every SysEx in both directions. Three send paths, each guarded:
 * request() sends GET queries only; edit() sends live-edit commands only (chain, model, parameter,
 * on/off, preset volume); presetOperation() sends only preset selections and user-slot saves.
 */
export class PocketMasterLink {
  readonly #input: MIDIInput;
  readonly #output: MIDIOutput;
  readonly #onLog: (entry: LogEntry) => void;
  readonly #assembler = new Reassembler();
  /** Waiters for a reply; each returns true when it consumed the frame. */
  readonly #listeners = new Set<(frame: Frame) => boolean>();
  readonly #onNotify: (frame: Frame) => void;
  /** Resolvers of pending waits, so close() can end them at once. */
  readonly #pending = new Set<() => void>();
  #closed = false;
  /** Edits waiting for their slot; one entry per key, holding the latest bytes. */
  #queue: readonly { readonly key: string; readonly bytes: Uint8Array }[] = [];
  #pumpTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #drainWaiters = new Set<() => void>();
  /** `onNotify` gets complete frames no request was waiting for: changes made on the pedal itself. */
  constructor(input: MIDIInput, output: MIDIOutput, onLog: (entry: LogEntry) => void, onNotify: (frame: Frame) => void = () => undefined) {
    this.#input = input;
    this.#output = output;
    this.#onLog = onLog;
    this.#onNotify = onNotify;
    this.#input.onmidimessage = (event) => this.#receive(event);
  }

  /** Stops listening and cancels pending requests; nothing is sent after this. */
  close(): void {
    this.#closed = true;
    this.#input.onmidimessage = null;
    if (this.#pumpTimer) clearTimeout(this.#pumpTimer);
    this.#pumpTimer = null;
    this.#queue = [];
    this.#resolveDrained();
    this.#pending.forEach((cancel) => cancel());
    this.#listeners.clear();
  }

  /** Sends a query and resolves with the (reassembled) reply. Retries, then rejects with a readable error. */
  async request(kind: QueryKind): Promise<Frame> {
    for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
      if (this.#closed) throw new LinkClosedError();
      const reply = this.#waitFor(kind);
      this.#send(queryFrame(kind));
      const frame = await reply;
      if (this.#closed) throw new LinkClosedError();
      if (frame) return frame;
    }
    throw new Error(`The pedal did not answer query 12 ${kind.toString(16).toUpperCase()} after ${REQUEST_RETRIES + 1} tries.`);
  }

  /**
   * Queues a live-edit command. The first goes out at once, later ones every EDIT_GAP_MS.
   * A newer edit with the same key replaces the queued one, so a drag sends its latest value.
   * The replacement goes to the back of the queue. The key comes from the bytes (editKey).
   */
  edit(bytes: Uint8Array): void {
    if (this.#closed) throw new LinkClosedError();
    if (!isAllowedEdit(bytes)) throw new Error('Blocked: only chain, model, parameter and on/off edits can be sent.');
    const key = editKey(bytes);
    // Drop the pending edit with the same key and append the new one, so it never overtakes
    // something queued after it (a parameter must follow the model change it belongs to).
    this.#queue = [...this.#queue.filter((q) => q.key !== key), { key, bytes }];
    if (!this.#pumpTimer) this.#pump();
  }

  /**
   * Selects a preset or saves to a user slot, after queued edits are written. A save resolves with
   * the pedal's acknowledge (true ok, false failed) and is never re-sent; no acknowledge rejects.
   */
  async presetOperation(bytes: Uint8Array): Promise<boolean> {
    if (this.#closed) throw new LinkClosedError();
    if (!isPresetOperation(bytes)) throw new Error('Blocked: only preset selections and user-slot saves can be sent here.');
    await this.drained();
    if (this.#closed) throw new LinkClosedError();
    const isSave = parseFrame(bytes).payload[1] === PresetCommand.SAVE;
    const ack = isSave ? this.#waitForAck() : null;
    this.#transmit(bytes);
    if (!ack) return true;
    const frame = await ack;
    if (this.#closed) throw new LinkClosedError();
    if (!frame) throw new Error('The pedal sent no acknowledge for the save; treat it as not saved.');
    return decodeAck(frame.payload);
  }

  #waitForAck(): Promise<Frame | null> {
    return new Promise((resolve) => {
      const listener = (frame: Frame) => {
        if (frame.payload[0] !== ACK.TYPE || frame.payload[1] !== ACK.COMMAND) return false;
        done(frame);
        return true;
      };
      const cancel = () => done(null);
      const timer = setTimeout(cancel, ACK_TIMEOUT_MS);
      const done = (frame: Frame | null) => {
        clearTimeout(timer);
        this.#listeners.delete(listener);
        this.#pending.delete(cancel);
        resolve(frame);
      };
      this.#listeners.add(listener);
      this.#pending.add(cancel);
    });
  }

  /** Resolves once every queued edit has been written to the port. */
  drained(): Promise<void> {
    if (this.#queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.add(resolve));
  }

  #pump(): void {
    const [next, ...rest] = this.#queue;
    if (!next) {
      this.#pumpTimer = null;
      return;
    }
    this.#queue = rest;
    this.#transmit(next.bytes);
    if (rest.length === 0) this.#resolveDrained();
    this.#pumpTimer = setTimeout(() => this.#pump(), EDIT_GAP_MS);
  }

  #resolveDrained(): void {
    this.#drainWaiters.forEach((resolve) => resolve());
    this.#drainWaiters.clear();
  }

  #send(bytes: Uint8Array): void {
    if (this.#closed) throw new LinkClosedError();
    if (!isReadOnly(bytes)) throw new Error('Blocked: request() only sends read queries to the pedal.');
    this.#transmit(bytes);
  }

  #transmit(bytes: Uint8Array): void {
    this.#log('TX', bytes);
    this.#output.send(bytes);
  }

  #waitFor(kind: QueryKind): Promise<Frame | null> {
    return new Promise((resolve) => {
      const listener = (frame: Frame) => {
        if (!isReply(frame, kind)) return false;
        done(frame);
        return true;
      };
      const cancel = () => done(null);
      const timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
      const done = (frame: Frame | null) => {
        clearTimeout(timer);
        this.#listeners.delete(listener);
        this.#pending.delete(cancel);
        resolve(frame);
      };
      this.#listeners.add(listener);
      this.#pending.add(cancel);
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
    if (!complete) return;
    // Every waiter sees the frame (two reads may wait for the same reply).
    const consumed = [...this.#listeners].map((listener) => listener(complete)).includes(true);
    if (!consumed) this.#onNotify(complete);
  }

  #log(dir: LogEntry['dir'], bytes: Uint8Array): void {
    this.#onLog({ id: nextLogId++, time: Date.now(), dir, hex: toHex(bytes), note: describeMessage(bytes) });
  }
}
