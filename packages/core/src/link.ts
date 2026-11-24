import { editKey, isAllowedEdit, isAllowedGlobalWrite } from './commands.ts';
import { factoryReset } from './globals.ts';
import { describeMessage } from './describe.ts';
import { parseFrame, type Frame } from './frame.ts';
import { toHex } from './hex.ts';
import { isReadOnly, isReply, MessageType, Query, queryFrame, type QueryKind } from './queries.ts';
import { chunkFrames, isUploadBlob, type UploadDomain } from './ir-upload.ts';
import { Reassembler } from './reassembler.ts';
import { decodeAck, isPresetOperation, PresetCommand, tunerMessage } from './slots.ts';

/**
 * The two things the link needs from a MIDI connection, so the same guarded link runs over
 * Web MIDI in the browser and over a native MIDI library in Node.
 */
export interface MidiPort {
  send(bytes: Uint8Array): void;
  /** Starts delivering every incoming MIDI message to `receiver`; null stops it. */
  listen(receiver: ((bytes: Uint8Array) => void) | null): void;
}

export interface LogEntry {
  readonly id: number;
  readonly time: number;
  readonly dir: 'TX' | 'RX';
  readonly hex: string;
  readonly note: string;
}

const SYSEX_START = 0xf0;
const REQUEST_TIMEOUT_MS = 1500;
const REQUEST_RETRIES = 2; // USB MIDI occasionally drops a packet of a multi-packet reply
/** Spacing between edit messages so a slider drag cannot flood the pedal. */
export const EDIT_GAP_MS = 20;
/** The pedal acknowledges a save within this time or the save counts as failed. */
const ACK_TIMEOUT_MS = 3000;
const ACK = { TYPE: 0x14, COMMAND: 0x08 } as const;
/** The pedal acknowledges every edit too; a preset operation waits this long at most for those. */
const EDIT_ACK_WAIT_MS = 300;
/** Upload chunks: the pedal sometimes drops one acknowledge, so a chunk is sent again (SonicMaster). */
const UPLOAD_ACK_TIMEOUT_MS = 1200;
const UPLOAD_TRIES = 10;
/** After the last chunk the pedal writes flash (2-3 s) and then sends 12 1B <domain>. */
const FLASH_WRITE_TIMEOUT_MS = 5000;
const FLASH_WRITTEN = 0x1b;
const SESSION_TIMEOUT_MS = 1000;

let nextLogId = 0; // module-wide so log keys stay unique across reconnects

const sendError = (error: unknown) => new Error(`Could not send to the pedal: ${error instanceof Error ? error.message : String(error)}. Check the USB cable and that the pedal is on.`);

/** Thrown by a request that was pending, or started, after the link was closed. */
export class LinkClosedError extends Error {
  constructor() {
    super('The connection to the pedal was closed.');
  }
}

/**
 * Link to a Pocket Master. Logs every SysEx in both directions. Three send paths, each guarded:
 * request() sends GET queries only; edit() sends live-edit commands only (chain, model, parameter,
 * on/off, preset volume); presetOperation() sends only preset selections and user-slot saves.
 */
export class PocketMasterLink {
  readonly #port: MidiPort;
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
  /** Edits sent whose 14 08 acknowledge has not arrived yet; those acknowledges are consumed here. */
  #editAcksPending = 0;
  #requests: Promise<unknown> = Promise.resolve();
  #inFlight = 0;
  /** Timeout restarts of the requests waiting for a reply, called as its packets arrive. */
  #progress = new Set<() => void>();
  #editAcksSettled: (() => void) | null = null;
  /** `onNotify` gets complete frames no request was waiting for: changes made on the pedal itself. */
  constructor(port: MidiPort, onLog: (entry: LogEntry) => void, onNotify: (frame: Frame) => void = () => undefined) {
    this.#port = port;
    this.#onLog = onLog;
    this.#onNotify = onNotify;
    this.#port.listen((bytes) => this.#receive(bytes));
  }

  /** Stops listening and cancels pending requests; nothing is sent after this. */
  close(): void {
    this.#closed = true;
    this.#port.listen(null);
    if (this.#pumpTimer) clearTimeout(this.#pumpTimer);
    this.#pumpTimer = null;
    this.#queue = [];
    this.#resolveDrained();
    this.#pending.forEach((cancel) => cancel());
    this.#listeners.clear();
  }

  /**
   * Sends a query and resolves with the (reassembled) reply. Retries, then rejects with a readable
   * error. Queries go out one at a time: replies are matched by kind and joined by packet count,
   * so two in flight could mix (a slow Bluetooth names reply overlapping the preset read).
   */
  request(kind: QueryKind, args: readonly number[] = []): Promise<Frame> {
    // Idle: send now, synchronously, as before. Otherwise wait for every query ahead, queued or
    // running (counted together, so a third query cannot slip in between two).
    const idle = this.#inFlight === 0;
    this.#inFlight += 1;
    const start = () =>
      this.#requestNow(kind, args).finally(() => {
        this.#inFlight -= 1;
      });
    const run = idle ? start() : this.#requests.then(start);
    this.#requests = run.catch(() => undefined); // a failed query never blocks the next one
    return run;
  }

  async #requestNow(kind: QueryKind, args: readonly number[]): Promise<Frame> {
    for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
      if (this.#closed) throw new LinkClosedError();
      const reply = this.#waitFor(kind);
      try {
        this.#send(queryFrame(kind, args));
      } catch (error) {
        this.#cancelWaits();
        await reply;
        throw sendError(error);
      }
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
    if (!isAllowedEdit(bytes) && !isAllowedGlobalWrite(bytes)) throw new Error('Blocked: only chain, model, parameter, on/off and global-setting edits can be sent.');
    const key = editKey(bytes);
    // Drop the pending edit with the same key and append the new one, so it never overtakes
    // something queued after it (a parameter must follow the model change it belongs to).
    this.#queue = [...this.#queue.filter((q) => q.key !== key), { key, bytes }];
    if (!this.#pumpTimer) this.#pump();
  }

  /** Turns the tuner on or off, after queued edits are written. The pedal neither answers nor reports it. */
  async setTuner(on: boolean): Promise<void> {
    if (this.#closed) throw new LinkClosedError();
    await this.drained();
    if (this.#closed) throw new LinkClosedError();
    try {
      this.#transmit(tunerMessage(on));
    } catch (error) {
      throw sendError(error);
    }
  }

  /**
   * Factory reset, after queued edits are written: every setting and preset returns to factory
   * state and the pedal reboots, so the link drops. Nothing waits for a reply.
   */
  async factoryReset(): Promise<void> {
    if (this.#closed) throw new LinkClosedError();
    await this.drained();
    await this.#editAcks();
    if (this.#closed) throw new LinkClosedError();
    try {
      this.#transmit(factoryReset());
    } catch (error) {
      throw sendError(error);
    }
  }

  /**
   * Selects a preset or saves to a user slot, after queued edits are written. Resolves with the
   * pedal's acknowledge (true ok, false failed); it is never re-sent and no acknowledge rejects.
   */
  async presetOperation(bytes: Uint8Array): Promise<boolean> {
    if (this.#closed) throw new LinkClosedError();
    if (!isPresetOperation(bytes)) throw new Error('Blocked: only preset selections, user-slot saves and copies can be sent here.');
    await this.drained();
    await this.#editAcks();
    if (this.#closed) throw new LinkClosedError();
    // The pedal acknowledges every selection and every save with 14 08 xx (seen on V1.3.3).
    // Waiting for each one keeps a late selection acknowledge from being read as the save's.
    const isSave = parseFrame(bytes).payload[1] !== PresetCommand.SELECT; // a save or a copy
    const ack = this.#waitForAck();
    try {
      this.#transmit(bytes);
    } catch (error) {
      this.#cancelWaits();
      await ack;
      throw sendError(error);
    }
    const frame = await ack;
    if (this.#closed) throw new LinkClosedError();
    if (!frame) {
      throw new Error(isSave ? 'The pedal sent no acknowledge for the save; treat it as not saved.' : 'The pedal sent no acknowledge for the preset selection.');
    }
    return decodeAck(frame.payload);
  }

  /**
   * Writes an upload blob (a user IR or its new name) in acknowledged chunks, then waits until
   * the pedal reports the flash write. Resolves only when the blob is in the pedal's memory.
   */
  async upload(blob: Uint8Array, domain: UploadDomain): Promise<void> {
    if (this.#closed) throw new LinkClosedError();
    if (!isUploadBlob(blob, domain)) throw new Error('Blocked: only user IR and captured-profile uploads and renames can be sent on the upload path.');
    await this.drained();
    await this.#editAcks();
    const frames = chunkFrames(blob);
    for (const [i, frame] of frames.entries()) {
      let ack: Frame | null = null;
      for (let attempt = 0; attempt < UPLOAD_TRIES && !ack; attempt++) {
        const reply = this.#waitForAck(UPLOAD_ACK_TIMEOUT_MS);
        try {
          this.#transmit(frame);
        } catch (error) {
          this.#cancelWaits();
          await reply;
          throw sendError(error);
        }
        ack = await reply;
        if (this.#closed) throw new LinkClosedError();
      }
      const which = `chunk ${i + 1} of ${frames.length}`;
      if (!ack) throw new Error(`The pedal sent no acknowledge for ${which}; the upload stopped and nothing was saved.`);
      if (!decodeAck(ack.payload)) throw new Error(`The pedal refused ${which}; the upload stopped and nothing was saved.`);
    }
    const written = await this.#waitForFrame((f) => f.payload[0] === MessageType.GET && f.payload[1] === FLASH_WRITTEN && f.payload[2] === domain, FLASH_WRITE_TIMEOUT_MS);
    if (this.#closed) throw new LinkClosedError();
    if (!written) {
      throw new Error('The pedal took the upload but did not write it to memory, so it is not saved. Switch the pedal off and on, then try again.');
    }
  }

  /** Sends 12 30, which opens the edit session, and goes on after any reply or one second. */
  async enterSession(): Promise<void> {
    if (this.#closed) throw new LinkClosedError();
    const reply = this.#waitForFrame((f) => f.payload[0] === MessageType.GET, SESSION_TIMEOUT_MS);
    try {
      this.#send(queryFrame(Query.SESSION));
    } catch (error) {
      this.#cancelWaits();
      await reply;
      throw sendError(error);
    }
    await reply;
    if (this.#closed) throw new LinkClosedError();
  }

  #waitForAck(timeoutMs = ACK_TIMEOUT_MS): Promise<Frame | null> {
    return this.#waitForFrame((frame) => frame.payload[0] === ACK.TYPE && frame.payload[1] === ACK.COMMAND, timeoutMs);
  }

  /** Resolves with the first complete frame `match` accepts (consuming it), or null after `timeoutMs`. */
  #waitForFrame(match: (frame: Frame) => boolean, timeoutMs: number): Promise<Frame | null> {
    return new Promise((resolve) => {
      const listener = (frame: Frame) => {
        if (!match(frame)) return false;
        done(frame);
        return true;
      };
      const cancel = () => done(null);
      const timer = setTimeout(cancel, timeoutMs);
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
    try {
      this.#transmit(next.bytes);
      this.#editAcksPending += 1;
    } catch (error) {
      // The port is gone: drop the queue so drained() resolves and the next read reports the error.
      console.error('could not send an edit to the pedal', error);
      this.#queue = [];
      this.#pumpTimer = null;
      this.#resolveDrained();
      return;
    }
    if (rest.length === 0) this.#resolveDrained();
    this.#pumpTimer = setTimeout(() => this.#pump(), EDIT_GAP_MS);
  }

  /** Waits until the edits already sent are acknowledged, at most EDIT_ACK_WAIT_MS. */
  #editAcks(): Promise<void> {
    if (this.#editAcksPending === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(), EDIT_ACK_WAIT_MS);
      const finish = () => {
        clearTimeout(timer);
        this.#editAcksPending = 0; // an edit that is never acknowledged must not swallow a later one
        this.#editAcksSettled = null;
        resolve();
      };
      this.#editAcksSettled = finish;
    });
  }

  /** Ends every pending wait (they resolve with no reply). */
  #cancelWaits(): void {
    this.#pending.forEach((cancel) => cancel());
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
    this.#port.send(bytes);
  }

  /** Waits for the reply; every packet of a multi-packet reply still arriving restarts the timeout. */
  #waitFor(kind: QueryKind): Promise<Frame | null> {
    return new Promise((resolve) => {
      const listener = (frame: Frame) => {
        if (!isReply(frame, kind)) return false;
        done(frame);
        return true;
      };
      const cancel = () => done(null);
      let timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
      const progress = () => {
        clearTimeout(timer);
        timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
      };
      const done = (frame: Frame | null) => {
        clearTimeout(timer);
        this.#listeners.delete(listener);
        this.#pending.delete(cancel);
        this.#progress.delete(progress);
        resolve(frame);
      };
      this.#listeners.add(listener);
      this.#pending.add(cancel);
      this.#progress.add(progress);
    });
  }

  #receive(data: Uint8Array): void {
    if (data[0] !== SYSEX_START) return; // only SysEx is logged and decoded
    this.#log('RX', data);
    let frame: Frame;
    try {
      frame = parseFrame(data);
    } catch {
      return; // logged above as "not a Pocket Master frame"
    }
    if (!frame.crcOk) return;
    const complete = this.#assembler.feed(frame, performance.now());
    if (!complete) {
      // ponytail: any partial packet keeps every waiter alive; replies are read one kind at a time
      if (frame.total > 1) this.#progress.forEach((keepWaiting) => keepWaiting());
      return;
    }
    if (this.#editAcksPending > 0 && complete.payload[0] === ACK.TYPE && complete.payload[1] === ACK.COMMAND) {
      this.#editAcksPending -= 1; // an edit's acknowledge: never let it answer a selection or a save
      if (this.#editAcksPending === 0) this.#editAcksSettled?.();
      return;
    }
    // Every waiter sees the frame (two reads may wait for the same reply).
    const consumed = [...this.#listeners].map((listener) => listener(complete)).includes(true);
    if (!consumed) this.#onNotify(complete);
  }

  #log(dir: LogEntry['dir'], bytes: Uint8Array): void {
    this.#onLog({ id: nextLogId++, time: Date.now(), dir, hex: toHex(bytes), note: describeMessage(bytes) });
  }
}
