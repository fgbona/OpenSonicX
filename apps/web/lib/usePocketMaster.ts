'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdit,
  decodeCurrentPreset,
  decodeFirmware,
  fromHex,
  decodeNotification,
  decodePreset,
  diffPresets,
  editToCommands,
  MessageType,
  Query,
  backupAllSlots,
  loadIntoEditBuffer,
  presetFile,
  presetLabel,
  restoreAllFromBackup,
  restoreFromBackup,
  saveToSlot,
  type BackupFile,
  type Edit,
  type Frame,
  type Pedal,
  type Preset,
  type PresetFile,
  type Progress,
  type SaveResult,
  type SlotBackup,
} from '@pocket-master/core';
import type { MidiPort, PedalKind } from '@pocket-master/core';
import { copyStoredPreset, LinkClosedError, linkPedal, PocketMasterLink, readProfileNames, readUserIrNames, toneGear, type LogEntry } from '@pocket-master/core';
import { findPedal, openMidi, pedalPortsKey, webMidiPort, type FoundPedal } from './midi';
import { addToLibrary, libraryNow } from './presetLibrary';
import { EMPTY_HISTORY, record, redo as redoStep, undo as undoStep, type History } from './history';
import { connectBluetooth } from './ble';

/** A kept tone's main gear for the assistant; nothing when the file cannot be read. */
function gearOf(payload: string): string | undefined {
  try {
    return toneGear(decodePreset(fromHex(payload)));
  } catch {
    return undefined;
  }
}
import { downloadBackup, downloadJson, loadBackups, removeBackup, storeBackup } from './backupStore';

export const LOG_LIMIT = 2000;
/** After a model or chain change the pedal applies defaults; re-read once it settles. */
const SETTLE_MS = 250;

/** After a factory reset, look for the pedal again once it has had time to reboot. */
const REBOOT_MS = 5000;

/** idle: no MIDI access (yet); ready: MIDI on, waiting for a pedal to be plugged in. */
export type Status = 'idle' | 'requesting' | 'ready' | 'connecting' | 'connected' | 'reading';

export interface PocketMasterState {
  readonly status: Status;
  /** How the pedal is connected, while it is: USB MIDI ports or Bluetooth LE MIDI. */
  readonly transport: 'usb' | 'ble' | null;
  readonly error: string | null;
  /** The browser refused MIDI access (or wants a click first): the toolbar offers to ask again. */
  readonly midiRefused: boolean;
  readonly preset: Preset | null;
  readonly presetIndex: number | null;
  /** Edit buffer as first read for this preset; Revert brings the pedal back to it. */
  readonly restorePoint: Preset | null;
  readonly log: readonly LogEntry[];
  /** A save or restore in progress; live edit and automatic re-reads pause meanwhile. */
  readonly busy: Progress | null;
  /** Preset names as last read from the pedal (index 0..99). */
  readonly names: readonly string[] | null;
  /** Backups kept in this browser, newest first. */
  readonly backups: readonly BackupFile[];
  /** Backups taken by the last save or restore, offered for download when it ends. */
  readonly flowBackups: readonly BackupFile[];
  /** Set when the browser could not keep a backup; the user must download it. */
  readonly storageWarning: string | null;
  /** Names the owner gave the five user IR slots, null for an empty slot. */
  readonly irNames: readonly (string | null)[] | null;
  /** Names of the five captured-profile slots, null for an empty slot. */
  readonly profileNames: readonly (string | null)[] | null;
  /** The pedal's own "edit buffer differs from the slot" flag (12 45), null until read. */
  readonly pedalModified: boolean | null;
  /** Live edits that Undo and Redo step through; cleared when another preset is read. */
  readonly history: History;
  /** Firmware version reported by the pedal ("V1.3.3"), null until read or when unknown. */
  readonly firmware: string | null;
  /** The tuner as the editor last set it; the pedal does not report it. */
  readonly tuner: boolean;
  /** Which pedal is connected, told by its port name; the Matribox has its own editor. */
  readonly pedal: PedalKind | null;
  /** The Matribox II Pro's open ports while it is the connected pedal (its editor drives them). */
  readonly matribox: MidiPort | null;
}

const INITIAL: PocketMasterState = {
  transport: null,
  status: 'requesting',
  error: null,
  midiRefused: false, // the page asks for MIDI as it loads
  preset: null,
  presetIndex: null,
  restorePoint: null,
  log: [],
  busy: null,
  names: null,
  backups: [],
  flowBackups: [],
  storageWarning: null,
  irNames: null,
  profileNames: null,
  pedalModified: null,
  history: EMPTY_HISTORY,
  firmware: null,
  tuner: false,
  pedal: null,
  matribox: null,
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True when the pedal itself announced a preset change (footswitch or knob on the unit). */
const isPresetChange = (f: Frame) => f.payload[0] === MessageType.GET && f.payload[1] === Query.CURRENT_PRESET;
/** The pedal reports 12 45 01 after the first edit and 12 45 00 after a save or a preset load. */
const modifiedFlag = (f: Frame) => (f.payload[0] === MessageType.GET && f.payload[1] === Query.MODIFIED && f.payload.length >= 3 ? f.payload[2] !== 0 : null);

/** Edits of one control merge into one Undo step while it is being turned. */
const stepKey = (edits: readonly Edit[]): string | null => {
  const [e] = edits;
  if (edits.length !== 1 || !e) return null;
  if (e.kind === 'param') return `param:${e.module}:${e.alg}`;
  return e.kind === 'volume' ? 'volume' : null;
};

const safeModified = (preset: Preset | null, restorePoint: Preset | null) => {
  if (!preset || !restorePoint) return false;
  try {
    return diffPresets(preset, restorePoint).length > 0;
  } catch (e) {
    console.error('could not compare with the restore point', e);
    return true;
  }
};

export function usePocketMaster() {
  const [state, setState] = useState<PocketMasterState>(INITIAL);
  const access = useRef<MIDIAccess | null>(null);
  const link = useRef<PocketMasterLink | null>(null);
  const connecting = useRef(false);
  /** Closes what the link runs over: the Bluetooth connection; nothing for USB ports. */
  const transportClose = useRef<(() => void) | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Edits and Revert work on the latest values, not on a stale render.
  const presetRef = useRef<Preset | null>(null);
  const restoreRef = useRef<Preset | null>(null);
  // Written together with presetRef, so code running right after a read (the tone assistant's
  // tools) sees the new preset's index and modified flag before React renders the new state.
  const indexRef = useRef<number | null>(null);
  const pedalModifiedRef = useRef<boolean | null>(null);
  const historyRef = useRef<History>(EMPTY_HISTORY);
  /** The latest state, for the tone assistant's tool calls, which read it when they run. */
  const stateRef = useRef<PocketMasterState>(INITIAL);
  /** Bumped by every edit; a dump requested before the latest edit is stale. */
  const editGeneration = useRef(0);
  const notifyRef = useRef<(f: Frame) => void>(() => undefined);
  const busyRef = useRef(false);
  const backupsRef = useRef<BackupFile[]>([]);
  /** The USB ports the open connection runs over, to notice them being unplugged. */
  const usbPorts = useRef<{ input: string; output: string } | null>(null);
  /** The plugged-in pedal ports last seen (pedalPortsKey): a change is a plug or an unplug. */
  const seenPorts = useRef<string | null>(null);
  const syncRef = useRef<() => void>(() => undefined);
  const rebootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Counts USB connection attempts; drop() bumps it so an attempt in flight gives up. */
  const attempts = useRef(0);
  const requestingMidi = useRef(false);

  const patch = useCallback((p: Partial<PocketMasterState>) => setState((s) => ({ ...s, ...p })), []);

  const appendLog = useCallback((entry: LogEntry) => setState((s) => ({ ...s, log: [...s.log.slice(-(LOG_LIMIT - 1)), entry] })), []);

  /** Opens a plugged-in pedal even when its ports did not change (after Bluetooth or a reset). */
  const lookAgain = useCallback(() => {
    seenPorts.current = null;
    syncRef.current();
  }, []);

  /** Asks for MIDI (the page does on load) and follows pedals being plugged in and out from then on. */
  const enable = useCallback(async () => {
    if (access.current || requestingMidi.current) return;
    requestingMidi.current = true;
    patch({ status: 'requesting', error: null, midiRefused: false });
    try {
      const midi = await openMidi();
      access.current = midi;
      midi.onstatechange = () => syncRef.current();
      patch({ status: 'ready' });
      syncRef.current();
    } catch (e) {
      patch({ status: 'idle', error: message(e), midiRefused: 'requestMIDIAccess' in navigator });
    } finally {
      requestingMidi.current = false;
    }
  }, [patch]);

  const scheduleReread = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (busyRef.current) return; // a save or restore drives the pedal; it re-reads when done
    settleTimer.current = setTimeout(() => void readRef.current(), SETTLE_MS);
  }, []);

  /** Reads preset number and edit buffer. Resolves with the pedal's preset, or null if stale or failed. */
  /** `freshRestorePoint` makes this read the new restore point (after Revert reloads the slot). */
  /** `locked`: the caller holds the exclusive lock (busyRef) and reads as part of its operation. */
  const read = useCallback(
    async (options: { freshRestorePoint?: boolean; locked?: boolean } = {}): Promise<Preset | null> => {
      const current = link.current;
      if (!current || (busyRef.current && !options.locked)) return null;
      patch({ status: 'reading', error: null });
      try {
        await current.drained(); // never read while edits are still on their way
        const generation = editGeneration.current;
        const index = decodeCurrentPreset((await current.request(Query.CURRENT_PRESET)).payload);
        const preset = decodePreset((await current.request(Query.EDIT_BUFFER)).payload);
        const pedalModified = modifiedFlag(await current.request(Query.MODIFIED));
        if (link.current !== current) return null;
        if (editGeneration.current !== generation) {
          // An edit went out while the dump was in flight: this dump is older than the screen.
          scheduleReread();
          return null;
        }
        // A new preset on the pedal gets a new restore point; the same preset keeps the first one.
        const keep = !options.freshRestorePoint && restoreRef.current !== null && indexRef.current === index;
        const restorePoint = keep ? restoreRef.current! : preset;
        restoreRef.current = restorePoint;
        indexRef.current = index;
        pedalModifiedRef.current = pedalModified;
        historyRef.current = keep ? historyRef.current : EMPTY_HISTORY;
        presetRef.current = preset;
        setState((s) => ({ ...s, status: 'connected', preset, presetIndex: index, restorePoint, pedalModified, history: historyRef.current }));
        return preset;
      } catch (e) {
        // A read from a link that was closed or replaced must not touch the current state.
        if (e instanceof LinkClosedError || link.current !== current) return null;
        console.error('read failed', e);
        patch({ status: 'connected', error: message(e) });
        return null;
      }
    },
    [patch, scheduleReread],
  );
  const readRef = useRef(read);
  readRef.current = read;

  /**
   * Applies edits to the screen at once and queues them for the pedal. A new edit is recorded for
   * Undo; Undo and Redo pass the history they lead to instead. Returns why nothing was sent, or null.
   */
  const send = useCallback(
    (edits: readonly Edit[], history?: History): string | null => {
      const current = link.current;
      const preset = presetRef.current;
      if (!current || !preset) return 'The pedal is not connected.';
      if (busyRef.current) return 'The editor is busy (saving or loading).';
      if (edits.length === 0) return null;
      try {
        // Validate and build everything first; queue only when the whole list is good.
        const { next, commands } = edits.reduce((acc, e) => ({ next: applyEdit(acc.next, e), commands: [...acc.commands, ...editToCommands(acc.next, e)] }), {
          next: preset,
          commands: [] as Uint8Array[],
        });
        commands.forEach((bytes) => current.edit(bytes));
        editGeneration.current += 1;
        presetRef.current = next;
        historyRef.current = history ?? record(historyRef.current, preset, stepKey(edits), Date.now());
        patch({ preset: next, error: null, history: historyRef.current });
        // A model or chain change is followed by a re-read, so the screen shows the pedal's values.
        if (edits.some((e) => e.kind === 'model' || e.kind === 'chain')) scheduleReread();
        return null;
      } catch (e) {
        if (e instanceof LinkClosedError) return 'The connection to the pedal was closed.';
        console.error('edit failed', e);
        patch({ error: message(e) });
        return message(e);
      }
    },
    [patch, scheduleReread],
  );

  const edit = useCallback(
    (e: Edit) => {
      send([e]);
    },
    [send],
  );

  /** Sends the pedal back (or forward) to the preset of the previous (next) step. */
  const step = useCallback(
    (back: boolean) => {
      const preset = presetRef.current;
      if (!preset || busyRef.current) return;
      const moved = (back ? undoStep : redoStep)(historyRef.current, preset);
      if (!moved) return;
      const edits = diffPresets(preset, moved.target);
      if (edits.length > 0) {
        send(edits, moved.history);
        return;
      }
      historyRef.current = moved.history; // nothing to send: the pedal already matches
      patch({ history: moved.history });
    },
    [send, patch],
  );
  const undo = useCallback(() => step(true), [step]);
  const redo = useCallback(() => step(false), [step]);

  /**
   * The editor as the tone assistant's tools see it (preset reads, edits, Undo, Revert). Loading and
   * saving need the page's dialogs, so the page completes it into a ToneHost.
   */
  /** Throws the reason the assistant cannot change the sound now, if there is one. */
  const ready = () => {
    if (busyRef.current) throw new Error('The editor is busy (saving or loading); try again in a moment.');
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: ready only reads busyRef, so the copy from any render gives the same answer
  const assistantBase = useMemo(
    () => ({
      snapshot: () => {
        const s = stateRef.current;
        const preset = presetRef.current;
        const index = indexRef.current;
        if (!preset || index === null) throw new Error('No preset has been read from the pedal yet.');
        return {
          index,
          name: (s.names?.[index] ?? '').trim(),
          preset,
          slots: { irNames: s.irNames, profileNames: s.profileNames },
          modified: safeModified(preset, restoreRef.current) || pedalModifiedRef.current === true,
          names: s.names ?? [],
        };
      },
      async applyEdits(edits: readonly Edit[]) {
        ready();
        const failure = send(edits);
        if (failure) throw new Error(failure);
      },
      async undo() {
        ready();
        if (historyRef.current.past.length === 0) return false;
        undoRef.current();
        return true;
      },
      async revert() {
        ready();
        if (!(await revertRef.current())) throw new Error('The pedal did not reload the preset.');
      },
      savedTones: () => libraryNow().map((f) => ({ name: f.name, notes: f.notes, gear: gearOf(f.payload) })),
      async loadSavedTone(name: string) {
        ready();
        const file = libraryNow().find((f) => f.name.toLowerCase() === name.toLowerCase());
        if (!file) return false;
        if (!(await importRef.current(file))) throw new Error(stateRef.current.error ?? 'The pedal did not load the tone.');
        return true;
      },
      async keepTone(name: string, notes: string) {
        const payload = await exclusiveRef.current('Reading', (current) => linkPedal(current).readEditBuffer());
        if (!payload) throw new Error('The edit buffer could not be read from the pedal.');
        addToLibrary(presetFile(payload, name, undefined, notes));
      },
    }),
    [send],
  );

  /**
   * Reloads the preset from its slot, as switching presets on the unit does: the edit buffer goes
   * back to exactly what is saved (undecoded fields included), even if it was edited before connecting.
   */
  const undoRef = useRef(() => {});
  undoRef.current = undo;

  const revert = useCallback(async (): Promise<boolean> => {
    const current = link.current;
    const index = state.presetIndex;
    if (!current || index === null || busyRef.current) return false;
    busyRef.current = true;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    patch({ busy: { step: 'Preparing', done: 0, total: 1 }, error: null });
    try {
      await current.drained();
      await linkPedal(current).selectPreset(index);
    } catch (e) {
      busyRef.current = false;
      if (!(e instanceof LinkClosedError)) patch({ busy: null, error: message(e) });
      return false;
    }
    busyRef.current = false;
    patch({ busy: null });
    return (await read({ freshRestorePoint: true })) !== null;
  }, [state.presetIndex, read, patch]);
  const revertRef = useRef(revert);
  revertRef.current = revert;

  /** Re-reads the user IR and captured-profile slot names; they are only labels, so a failure is logged. */
  const refreshSlotNames = useCallback(async () => {
    const current = link.current;
    if (!current) return;
    try {
      const names = (slots: { name: string; empty: boolean }[]) => slots.map((s) => (s.empty || !s.name ? null : s.name));
      const irs = await readUserIrNames(current);
      const profiles = await readProfileNames(current);
      if (link.current === current) patch({ irNames: names(irs), profileNames: names(profiles) });
    } catch (e) {
      if (!(e instanceof LinkClosedError)) console.error('could not read the slot names', e);
    }
  }, [patch]);

  /** The firmware version, once per connection, from the settings reply; a failure leaves it unknown. */
  const readFirmware = useCallback(async () => {
    const current = link.current;
    if (!current) return;
    try {
      const firmware = decodeFirmware((await current.request(Query.GLOBALS)).payload);
      if (link.current === current) patch({ firmware });
    } catch (e) {
      if (!(e instanceof LinkClosedError)) console.warn('could not read the firmware version', e);
    }
  }, [patch]);

  /**
   * Opens a plugged-in pedal's USB ports and reads it; sync() picks the pedal. An attempt is
   * abandoned when drop() runs meanwhile (the pedal was unplugged while it was being opened).
   */
  const connect = useCallback(
    async ({ kind, input, output }: FoundPedal<MIDIInput, MIDIOutput>) => {
      if (connecting.current) return; // never a second link on the same ports
      connecting.current = true;
      const attempt = ++attempts.current;
      const stale = () => attempts.current !== attempt;
      link.current?.close();
      link.current = null;
      transportClose.current?.();
      transportClose.current = null;
      usbPorts.current = { input: input.id, output: output.id };
      restoreRef.current = null;
      presetRef.current = null;
      indexRef.current = null;
      pedalModifiedRef.current = null;
      historyRef.current = EMPTY_HISTORY;
      patch({ status: 'connecting', error: null, restorePoint: null, names: null, history: EMPTY_HISTORY, firmware: null, tuner: false, pedal: kind, matribox: null });
      try {
        await Promise.all([input.open(), output.open()]);
        if (stale()) return;
        const port = webMidiPort(input, output);
        if (kind === 'matribox') {
          // The Matribox II Pro speaks another protocol: its own editor drives the ports.
          transportClose.current = () => port.listen(null);
          patch({ status: 'connected', transport: 'usb', matribox: port });
          return;
        }
        link.current = new PocketMasterLink(port, appendLog, (f) => notifyRef.current(f));
        patch({ status: 'connected', transport: 'usb', error: null, irNames: null, profileNames: null });
        await read();
        await refreshSlotNames();
        await readFirmware();
      } catch (e) {
        if (stale()) return;
        console.error('connect failed', e);
        link.current = null;
        usbPorts.current = null;
        patch({ status: 'ready', pedal: null, error: `Could not open the ports: ${message(e)}` });
      } finally {
        if (!stale()) connecting.current = false;
      }
    },
    [patch, appendLog, read, refreshSlotNames, readFirmware],
  );

  /** Connects over Bluetooth LE MIDI instead of USB; the browser's chooser needs this click. */
  const connectBle = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    link.current?.close();
    link.current = null;
    transportClose.current?.();
    transportClose.current = null;
    usbPorts.current = null;
    restoreRef.current = null;
    presetRef.current = null;
    indexRef.current = null;
    pedalModifiedRef.current = null;
    const idle = () => (access.current ? 'ready' : 'idle') as Status;
    historyRef.current = EMPTY_HISTORY;
    patch({ status: 'connecting', error: null, restorePoint: null, names: null, history: EMPTY_HISTORY, firmware: null, tuner: false, pedal: 'pocket-master', matribox: null });
    try {
      const ble = await connectBluetooth(
        (e) => patch({ error: `Bluetooth: ${message(e)}` }),
        () => {
          link.current?.close();
          link.current = null;
          transportClose.current = null;
          patch({ status: idle(), transport: null, error: 'The pedal disconnected from Bluetooth.' });
          lookAgain();
        },
      );
      transportClose.current = ble.close;
      link.current = new PocketMasterLink(ble.port, appendLog, (f) => notifyRef.current(f));
      patch({ status: 'connected', transport: 'ble', error: null, irNames: null, profileNames: null });
      await read();
      await refreshSlotNames();
      await readFirmware();
    } catch (e) {
      // Closing the chooser without picking is not an error worth showing.
      const cancelled = e instanceof DOMException && e.name === 'NotFoundError';
      if (!cancelled) console.error('Bluetooth connect failed', e);
      link.current = null;
      transportClose.current?.();
      transportClose.current = null;
      patch({ status: idle(), error: cancelled ? null : `Could not connect over Bluetooth: ${message(e)}` });
    } finally {
      connecting.current = false;
      if (!link.current) lookAgain(); // a USB pedal still plugged in is opened again
    }
  }, [patch, appendLog, read, refreshSlotNames, readFirmware, lookAgain]);

  /** A device-wide setting write (setGlobal / setExpFsTarget bytes); queued like an edit. */
  const writeGlobal = useCallback(
    (bytes: Uint8Array) => {
      const current = link.current;
      if (!current || busyRef.current) return;
      try {
        current.edit(bytes);
      } catch (e) {
        if (e instanceof LinkClosedError) return;
        console.error('global setting write failed', e);
        patch({ error: message(e) });
      }
    },
    [patch],
  );

  /**
   * Runs `run` alone on the link (no edits or automatic re-reads meanwhile), then re-reads the slot
   * names and the preset. Resolves with its result, or null when it failed (the error is shown).
   */
  const exclusive = useCallback(
    async <T>(step: string, run: (current: PocketMasterLink) => Promise<T>): Promise<T | null> => {
      const current = link.current;
      if (!current) {
        patch({ error: 'Connect the pedal first.' });
        return null;
      }
      if (busyRef.current) {
        patch({ error: 'The pedal is busy with another operation; try again when it ends.' });
        return null;
      }
      busyRef.current = true;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      patch({ busy: { step, done: 0, total: 1 }, error: null });
      let result: T | null = null;
      let failure: string | null = null;
      try {
        await current.drained();
        result = await run(current);
      } catch (e) {
        failure = e instanceof LinkClosedError ? 'The connection to the pedal was closed during the operation.' : message(e);
      }
      // The follow-up reads still hold the lock, so nothing else talks to the pedal in between.
      try {
        await refreshSlotNames();
        await read({ locked: true });
      } finally {
        busyRef.current = false;
        // read() clears the error, so the operation's own failure is shown after it.
        patch({ busy: null, ...(failure ? { error: failure } : {}) });
      }
      return failure ? null : result;
    },
    [patch, read, refreshSlotNames],
  );
  const exclusiveRef = useRef(exclusive);
  exclusiveRef.current = exclusive;

  /**
   * Factory reset, then disconnect: the pedal reboots and drops the link, so there is nothing to
   * re-read (the exclusive() follow-up reads would only time out against it). True once sent.
   */
  const factoryReset = useCallback(async (): Promise<boolean> => {
    const current = link.current;
    if (!current || busyRef.current) return false;
    busyRef.current = true;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    patch({ busy: { step: 'Factory reset', done: 0, total: 1 }, error: null });
    try {
      await current.factoryReset();
      return true;
    } catch (e) {
      console.error('factory reset failed', e);
      patch({ error: `Factory reset was not sent: ${message(e)}` });
      return false;
    } finally {
      busyRef.current = false;
      patch({ busy: null });
    }
  }, [patch]);

  /** Loads another preset, like turning the preset knob; unsaved edits on the pedal are lost. */
  /** True once the pedal loaded it (false when busy or the link failed). */
  const loadPreset = useCallback(
    async (index: number): Promise<boolean> => {
      return (await exclusive('Loading', (current) => linkPedal(current).selectPreset(index))) !== null;
    },
    [exclusive],
  );

  /** Closes the connection and forgets the pedal's preset: the page goes back to waiting for one. */
  const drop = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    attempts.current += 1;
    connecting.current = false;
    link.current?.close();
    link.current = null;
    transportClose.current?.();
    transportClose.current = null;
    usbPorts.current = null;
    restoreRef.current = null;
    presetRef.current = null;
    indexRef.current = null;
    pedalModifiedRef.current = null;
    historyRef.current = EMPTY_HISTORY;
    patch({
      status: access.current ? 'ready' : 'idle',
      transport: null,
      tuner: false,
      pedal: null,
      matribox: null,
      preset: null,
      presetIndex: null,
      restorePoint: null,
      pedalModified: null,
      history: EMPTY_HISTORY,
      names: null,
      firmware: null,
    });
  }, [patch]);

  /**
   * Follows the USB pedals (MIDIAccess statechange): drops the connection when its ports are
   * unplugged (a power cycle leaves dead port objects behind), and opens a pedal when one is
   * plugged in and nothing is connected. A connection that is up is kept even when a pedal of
   * higher priority is plugged in: switching would pull the editor away mid-edit.
   */
  const sync = useCallback(() => {
    const midi = access.current;
    if (!midi) return;
    const inputs = [...midi.inputs.values()];
    const outputs = [...midi.outputs.values()];
    const usb = usbPorts.current;
    const plugged = (port: MIDIPort | undefined) => port?.state === 'connected';
    if (usb && !(plugged(midi.inputs.get(usb.input)) && plugged(midi.outputs.get(usb.output)))) drop();
    // Only a plug or an unplug opens a pedal: opening ports fires statechange too, and a pedal that
    // failed to open is not retried in a loop.
    const seen = pedalPortsKey([...inputs, ...outputs]);
    if (seen === seenPorts.current) return;
    seenPorts.current = seen;
    if (connecting.current || link.current || transportClose.current) return;
    const found = findPedal(inputs, outputs);
    if (found) void connect(found);
  }, [drop, connect]);
  syncRef.current = sync;

  /** After a factory reset: the pedal reboots; it is opened again when it comes back. */
  const reconnect = useCallback(() => {
    drop();
    if (rebootTimer.current) clearTimeout(rebootTimer.current);
    // ponytail: a fixed wait; if the unit drops its USB ports while rebooting, sync() reopens it sooner.
    rebootTimer.current = setTimeout(lookAgain, REBOOT_MS);
  }, [drop, lookAgain]);

  // Ask for MIDI on load, like the official app: silent when allowed before, the browser's prompt
  // the first time. Allowing it later in the site settings connects too, without a reload.
  useEffect(() => {
    void enable(); // without Web MIDI, this shows why USB is not available here
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'midi', sysex: true } as unknown as PermissionDescriptor)
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.onchange = () => {
          if (s.state === 'granted') void enable();
        };
      })
      .catch(() => undefined); // browsers without the MIDI permission name: the Allow button stays
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [enable]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rebootTimer.current) clearTimeout(rebootTimer.current);
      link.current?.close();
      transportClose.current?.();
    },
    [],
  );

  // The pedal reports what is played on it. A preset switch is re-read so edits never land on a
  // preset the screen does not show; knobs and block switches update the screen directly.
  notifyRef.current = (f: Frame) => {
    if (busyRef.current) return; // a save or restore is driving the pedal
    const flag = modifiedFlag(f);
    if (flag !== null) {
      pedalModifiedRef.current = flag;
      patch({ pedalModified: flag });
      return;
    }
    if (isPresetChange(f)) {
      scheduleReread();
      return;
    }
    const preset = presetRef.current;
    const change = preset ? decodeNotification(f.payload, preset) : null;
    if (!change || !preset) return;
    if (change.kind === 'reread') {
      scheduleReread();
      return;
    }
    try {
      const next = applyEdit(preset, change);
      editGeneration.current += 1; // a dump already in flight is older than this change
      presetRef.current = next;
      patch({ preset: next });
    } catch (e) {
      console.error('could not apply a change reported by the pedal; re-reading', e);
      scheduleReread();
    }
  };

  useEffect(() => {
    backupsRef.current = loadBackups();
    patch({ backups: backupsRef.current });
  }, [patch]);

  const keepBackup = useCallback((file: BackupFile) => {
    const { list, stored } = storeBackup(backupsRef.current, file);
    backupsRef.current = list;
    setState((s) => ({
      ...s,
      backups: list,
      flowBackups: [...s.flowBackups, file],
      storageWarning: stored ? s.storageWarning : 'This browser could not keep the backup. Download it now and keep the file.',
    }));
  }, []);

  /** Runs a save or restore flow with live edit paused; on success the saved preset is the new restore point. */
  const runFlow = useCallback(
    async (target: number, flow: (pedal: Pedal, onProgress: (p: Progress) => void) => Promise<SaveResult>) => {
      const current = link.current;
      if (!current || busyRef.current) return false;
      busyRef.current = true;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      patch({ busy: { step: 'Preparing', done: 0, total: 1 }, error: null, flowBackups: [] });
      let failure: string | null = null;
      try {
        await current.drained();
        const pedal = linkPedal(current);
        const result = await flow(pedal, (busy) => patch({ busy }));
        const names = await pedal.readNames();
        editGeneration.current += 1;
        presetRef.current = result.saved;
        restoreRef.current = result.saved;
        indexRef.current = target;
        pedalModifiedRef.current = false;
        busyRef.current = false;
        // The slot now holds the edit buffer, so the pedal no longer counts it as modified.
        patch({ busy: null, preset: result.saved, presetIndex: target, restorePoint: result.saved, names, pedalModified: false });
        return true;
      } catch (e) {
        console.error('save flow failed', e);
        failure = e instanceof LinkClosedError ? 'The connection to the pedal was closed during the save.' : message(e);
      }
      busyRef.current = false;
      // Re-sync the screen with the pedal first; the error is set after, so the read cannot clear it.
      if (link.current === current) await readRef.current();
      patch({ busy: null, error: failure });
      return false;
    },
    [patch],
  );

  const save = useCallback(
    (target: number, name: string, backup = true) => runFlow(target, (pedal, onProgress) => saveToSlot(pedal, { target, name, backup, edited: presetRef.current, onProgress, onBackup: keepBackup })),
    [runFlow, keepBackup],
  );

  /** Copies a stored preset over a user slot (checked by reading both back); the loaded preset is untouched. */
  const copyPreset = useCallback(
    async (destination: number, source: number) => {
      const current = link.current;
      if (!current || busyRef.current) return false;
      busyRef.current = true;
      patch({ busy: { step: `Copying ${presetLabel(source)} to ${presetLabel(destination)}`, done: 0, total: 1 }, error: null });
      try {
        await current.drained();
        await copyStoredPreset(current, destination, source);
        const names = await linkPedal(current).readNames();
        busyRef.current = false;
        patch({ busy: null, names });
        return true;
      } catch (e) {
        busyRef.current = false;
        if (e instanceof LinkClosedError) patch({ busy: null });
        else patch({ busy: null, error: message(e) });
        return false;
      }
    },
    [patch],
  );

  /** Backs up all 50 user presets (read without loading them), keeps it in the list and downloads the file. */
  const backupAll = useCallback(async () => {
    const current = link.current;
    if (!current || busyRef.current) return false;
    busyRef.current = true;
    patch({ busy: { step: 'Preparing', done: 0, total: 1 }, error: null, flowBackups: [] });
    try {
      await current.drained();
      const file = await backupAllSlots(linkPedal(current), { edited: presetRef.current, onProgress: (busy) => patch({ busy }), onBackup: keepBackup });
      downloadBackup(file);
      busyRef.current = false;
      patch({ busy: null });
      return true;
    } catch (e) {
      busyRef.current = false;
      patch({ busy: null, error: e instanceof LinkClosedError ? null : message(e) });
      return false;
    }
  }, [patch, keepBackup]);

  /** Writes a whole backup file back (after backing up the slots as they are now), then re-reads the pedal. */
  const restoreAll = useCallback(
    async (file: BackupFile) => {
      const current = link.current;
      if (!current || busyRef.current) return false;
      busyRef.current = true;
      patch({ busy: { step: 'Preparing', done: 0, total: 1 }, error: null, flowBackups: [] });
      try {
        await current.drained();
        await restoreAllFromBackup(linkPedal(current), file, { onProgress: (busy) => patch({ busy }), onBackup: keepBackup });
        busyRef.current = false;
        patch({ busy: null });
        await read({ freshRestorePoint: true });
        await refreshSlotNames();
        return true;
      } catch (e) {
        busyRef.current = false;
        patch({ busy: null, error: e instanceof LinkClosedError ? null : message(e) });
        return false;
      }
    },
    [patch, keepBackup, read, refreshSlotNames],
  );

  /** Turns the pedal's tuner on or off. */
  const setTuner = useCallback(
    async (on: boolean) => {
      const current = link.current;
      if (!current) return;
      try {
        await current.setTuner(on);
        patch({ tuner: on });
      } catch (e) {
        if (!(e instanceof LinkClosedError)) patch({ error: message(e) });
      }
    },
    [patch],
  );

  const restore = useCallback((slot: SlotBackup) => runFlow(slot.index, (pedal, onProgress) => restoreFromBackup(pedal, slot, { onProgress, onBackup: keepBackup })), [runFlow, keepBackup]);

  /** Re-reads the edit buffer from the pedal and hands it over as a preset file. */
  const exportPreset = useCallback(async () => {
    const current = link.current;
    if (!current || busyRef.current) return;
    try {
      await current.drained();
      const pedal = linkPedal(current);
      const [payload, index] = [await pedal.readEditBuffer(), await pedal.readCurrentIndex()];
      const names = await pedal.readNames();
      const name = (names[index] ?? '').trim();
      const file = presetFile(payload, name);
      const safe = (name || presetLabel(index)).replace(/[^A-Za-z0-9_-]+/g, '_');
      downloadJson(file, `pocket-master-${presetLabel(index)}-${safe}.json`);
      addToLibrary(file);
    } catch (e) {
      if (!(e instanceof LinkClosedError)) patch({ error: message(e) });
    }
  }, [patch]);

  /** Loads a preset file into the edit buffer (nothing is saved); Revert still brings back the old one. */
  const importRef = useRef<(file: PresetFile) => Promise<boolean>>(async () => false);
  const importPreset = useCallback(
    async (file: PresetFile) => {
      const current = link.current;
      if (!current || busyRef.current) return false;
      busyRef.current = true;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      patch({ busy: { step: 'Preparing', done: 0, total: 1 }, error: null });
      let failure: string | null = null;
      try {
        await current.drained();
        const loaded = await loadIntoEditBuffer(linkPedal(current), decodePreset(fromHex(file.payload)));
        editGeneration.current += 1;
        presetRef.current = loaded;
        busyRef.current = false;
        patch({ busy: null, preset: loaded });
        return true;
      } catch (e) {
        console.error('import failed', e);
        failure = e instanceof LinkClosedError ? 'The connection to the pedal was closed during the save.' : message(e);
      }
      busyRef.current = false;
      if (link.current === current) await readRef.current();
      patch({ busy: null, error: failure });
      return false;
    },
    [patch],
  );
  importRef.current = importPreset;

  const loadNames = useCallback(async () => {
    const current = link.current;
    if (!current || busyRef.current) return;
    try {
      patch({ names: await linkPedal(current).readNames() });
    } catch (e) {
      if (!(e instanceof LinkClosedError)) patch({ error: message(e) });
    }
  }, [patch]);

  const importBackup = useCallback(
    (file: BackupFile) => {
      const { list, stored } = storeBackup(backupsRef.current, file);
      backupsRef.current = list;
      patch({ backups: list, storageWarning: stored ? null : 'This browser could not keep the imported backup; keep the file.' });
    },
    [patch],
  );

  const deleteBackup = useCallback(
    (file: BackupFile) => {
      const { list, stored } = removeBackup(backupsRef.current, file);
      backupsRef.current = list;
      patch({ backups: list, storageWarning: stored ? null : 'This browser could not save the change; the backup may come back after a reload.' });
    },
    [patch],
  );

  const modified = useMemo(() => safeModified(state.preset, state.restorePoint) || state.pedalModified === true, [state.preset, state.restorePoint, state.pedalModified]);

  stateRef.current = state;
  return {
    ...state,
    assistantBase,
    modified,
    enable,
    connectBle: () => void connectBle(),
    reconnect,
    read,
    edit,
    revert: () => void revert(),
    undo,
    redo,
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    save,
    copyPreset,
    backupAll,
    restoreAll,
    setTuner,
    restore,
    loadNames,
    loadPreset: (index: number) => void loadPreset(index),
    /** loadPreset that can be awaited (the tone assistant waits for the new preset). */
    loadPresetNow: loadPreset,
    exclusive,
    writeGlobal,
    factoryReset,
    refreshSlotNames,
    importBackup,
    deleteBackup,
    exportPreset: () => void exportPreset(),
    importPreset,
    downloadBackup,
    clearLog: () => patch({ log: [] }),
    showError: (error: string) => patch({ error }),
    clearError: () => patch({ error: null }),
  };
}
