'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdit, decodeCurrentPreset, fromHex, decodeNotification, decodePreset, diffPresets, editToCommands, MessageType, Query,
  loadIntoEditBuffer, paramSpecFor, presetFile, presetLabel, restoreFromBackup, saveToSlot,
  type BackupFile, type Edit, type Frame, type Pedal, type Preset, type PresetFile, type Progress, type SaveResult, type SlotBackup,
} from '@pocket-master/core';
import { LinkClosedError, linkPedal, PocketMasterLink, readProfileNames, readUserIrNames, type LogEntry } from '@pocket-master/core';
import { openMidi, pickPocketMaster, webMidiPort } from './midi';
import { downloadBackup, downloadJson, loadBackups, storeBackup } from './backupStore';

export const LOG_LIMIT = 2000;
/** After a model or chain change the pedal applies defaults; re-read once it settles. */
const SETTLE_MS = 250;

export type Status = 'idle' | 'requesting' | 'ready' | 'connecting' | 'connected' | 'reading';

export interface PortOption {
  readonly id: string;
  readonly name: string;
}

export interface PocketMasterState {
  readonly status: Status;
  readonly error: string | null;
  readonly inputs: readonly PortOption[];
  readonly outputs: readonly PortOption[];
  readonly inputId: string;
  readonly outputId: string;
  readonly preset: Preset | null;
  readonly presetIndex: number | null;
  /** Edit buffer as first read for this preset; Revert brings the pedal back to it. */
  readonly restorePoint: Preset | null;
  readonly liveEdit: boolean;
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
}

const INITIAL: PocketMasterState = {
  status: 'idle', error: null, inputs: [], outputs: [], inputId: '', outputId: '',
  preset: null, presetIndex: null, restorePoint: null, liveEdit: false, log: [],
  busy: null, names: null, backups: [], flowBackups: [], storageWarning: null, irNames: null, profileNames: null, pedalModified: null,
};

const toOptions = (ports: Iterable<MIDIPort>): PortOption[] =>
  Array.from(ports, (p) => ({ id: p.id, name: p.name ?? p.id }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True when the pedal itself announced a preset change (footswitch or knob on the unit). */
const isPresetChange = (f: Frame) => f.payload[0] === MessageType.GET && f.payload[1] === Query.CURRENT_PRESET;
/** The pedal reports 12 45 01 after the first edit and 12 45 00 after a save or a preset load. */
const modifiedFlag = (f: Frame) => (f.payload[0] === MessageType.GET && f.payload[1] === Query.MODIFIED && f.payload.length >= 3 ? f.payload[2] !== 0 : null);

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
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Edits and Revert work on the latest values, not on a stale render.
  const presetRef = useRef<Preset | null>(null);
  const restoreRef = useRef<Preset | null>(null);
  /** Bumped by every edit; a dump requested before the latest edit is stale. */
  const editGeneration = useRef(0);
  const notifyRef = useRef<(f: Frame) => void>(() => undefined);
  const busyRef = useRef(false);
  const backupsRef = useRef<BackupFile[]>([]);

  const patch = useCallback((p: Partial<PocketMasterState>) => setState((s) => ({ ...s, ...p })), []);

  const appendLog = useCallback(
    (entry: LogEntry) => setState((s) => ({ ...s, log: [...s.log.slice(-(LOG_LIMIT - 1)), entry] })),
    [],
  );

  const refreshPorts = useCallback(() => {
    const midi = access.current;
    if (!midi) return;
    const inputs = Array.from(midi.inputs.values());
    const outputs = Array.from(midi.outputs.values());
    setState((s) => ({
      ...s,
      inputs: toOptions(inputs),
      outputs: toOptions(outputs),
      // Never preselect another device: Connect would send Pocket Master SysEx to it.
      inputId: inputs.some((p) => p.id === s.inputId) ? s.inputId : (pickPocketMaster(inputs)?.id ?? ''),
      outputId: outputs.some((p) => p.id === s.outputId) ? s.outputId : (pickPocketMaster(outputs)?.id ?? ''),
    }));
  }, []);

  const enable = useCallback(async () => {
    patch({ status: 'requesting', error: null });
    try {
      const midi = await openMidi();
      access.current = midi;
      midi.onstatechange = refreshPorts;
      refreshPorts();
      patch({ status: 'ready' });
    } catch (e) {
      patch({ status: 'idle', error: message(e) });
    }
  }, [patch, refreshPorts]);

  const scheduleReread = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (busyRef.current) return; // a save or restore drives the pedal; it re-reads when done
    settleTimer.current = setTimeout(() => void readRef.current(), SETTLE_MS);
  }, []);

  /** Reads preset number and edit buffer. Resolves with the pedal's preset, or null if stale or failed. */
  /** `freshRestorePoint` makes this read the new restore point (after Revert reloads the slot). */
  /** `locked`: the caller holds the exclusive lock (busyRef) and reads as part of its operation. */
  const read = useCallback(async (options: { freshRestorePoint?: boolean; locked?: boolean } = {}): Promise<Preset | null> => {
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
      setState((s) => {
        // A new preset on the pedal gets a new restore point; the same preset keeps the first one.
        const keep = !options.freshRestorePoint && s.restorePoint && s.presetIndex === index;
        const restorePoint = keep ? s.restorePoint : preset;
        restoreRef.current = restorePoint;
        return { ...s, status: 'connected', preset, presetIndex: index, restorePoint, pedalModified };
      });
      presetRef.current = preset;
      return preset;
    } catch (e) {
      // A read from a link that was closed or replaced must not touch the current state.
      if (e instanceof LinkClosedError || link.current !== current) return null;
      console.error('read failed', e);
      patch({ status: 'connected', error: message(e) });
      return null;
    }
  }, [patch, scheduleReread]);
  const readRef = useRef(read);
  readRef.current = read;

  /** Applies edits to the screen at once and queues them for the pedal. */
  const send = useCallback(
    (edits: readonly Edit[]) => {
      const current = link.current;
      const preset = presetRef.current;
      if (!current || !preset || edits.length === 0 || busyRef.current) return;
      try {
        // Validate and build everything first; queue only when the whole list is good.
        const { next, commands } = edits.reduce(
          (acc, e) => ({ next: applyEdit(acc.next, e), commands: [...acc.commands, ...editToCommands(acc.next, e)] }),
          { next: preset, commands: [] as Uint8Array[] },
        );
        commands.forEach((bytes) => current.edit(bytes));
        editGeneration.current += 1;
        presetRef.current = next;
        patch({ preset: next, error: null });
        // A model or chain change, a footswitch move or a Sync switch (the pedal rewrites the
        // synced Time or Rate) is followed by a re-read, so the screen shows the pedal's values.
        const syncToggle = (e: Edit) => e.kind === 'param' && preset.chain.some((b) => b.module === e.module && paramSpecFor(preset, b, e.alg)?.name === 'Sync');
        if (edits.some((e) => e.kind === 'model' || e.kind === 'chain' || syncToggle(e))) scheduleReread();
      } catch (e) {
        if (e instanceof LinkClosedError) return;
        console.error('edit failed', e);
        patch({ error: message(e) });
      }
    },
    [patch, scheduleReread],
  );

  const edit = useCallback(
    (e: Edit) => {
      if (state.liveEdit) send([e]);
    },
    [state.liveEdit, send],
  );

  /**
   * Reloads the preset from its slot, as switching presets on the unit does: the edit buffer goes
   * back to exactly what is saved (undecoded fields included), even if it was edited before connecting.
   */
  const revert = useCallback(async () => {
    const current = link.current;
    const index = state.presetIndex;
    if (!state.liveEdit || !current || index === null || busyRef.current) return;
    busyRef.current = true;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    patch({ busy: { step: 'Preparing', done: 0, total: 1 }, error: null });
    try {
      await current.drained();
      await linkPedal(current).selectPreset(index);
    } catch (e) {
      busyRef.current = false;
      if (!(e instanceof LinkClosedError)) patch({ busy: null, error: message(e) });
      return;
    }
    busyRef.current = false;
    patch({ busy: null });
    await read({ freshRestorePoint: true });
  }, [state.liveEdit, state.presetIndex, read, patch]);

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

  const connect = useCallback(async () => {
    const midi = access.current;
    const input = midi?.inputs.get(state.inputId);
    const output = midi?.outputs.get(state.outputId);
    if (!input || !output) {
      patch({ error: 'Choose an input and an output port first.' });
      return;
    }
    if (connecting.current) return; // a double click must not open a second link on the same ports
    connecting.current = true;
    link.current?.close();
    link.current = null;
    restoreRef.current = null;
    presetRef.current = null;
    patch({ status: 'connecting', error: null, restorePoint: null, liveEdit: false, names: null });
    try {
      await Promise.all([input.open(), output.open()]);
      link.current = new PocketMasterLink(webMidiPort(input, output), appendLog, (f) => notifyRef.current(f));
      patch({ status: 'connected', error: null, irNames: null, profileNames: null });
      await read();
      await refreshSlotNames();
    } catch (e) {
      console.error('connect failed', e);
      link.current = null;
      patch({ status: 'ready', error: `Could not open the ports: ${message(e)}` });
    } finally {
      connecting.current = false;
    }
  }, [state.inputId, state.outputId, patch, appendLog, read, refreshSlotNames]);

  /**
   * Runs `run` alone on the link (no edits or automatic re-reads meanwhile), then re-reads the slot
   * names and the preset. Resolves with its result, or null when it failed (the error is shown).
   */
  const exclusive = useCallback(async <T,>(step: string, run: (current: PocketMasterLink) => Promise<T>): Promise<T | null> => {
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
  }, [patch, read, refreshSlotNames]);

  /** Loads another preset, like turning the preset knob; unsaved edits on the pedal are lost. */
  const loadPreset = useCallback(async (index: number) => {
    await exclusive('Loading', (current) => linkPedal(current).selectPreset(index));
  }, [exclusive]);

  const disconnect = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    link.current?.close();
    link.current = null;
    patch({ status: 'ready', liveEdit: false });
  }, [patch]);

  // Skip the Enable MIDI click when the visitor already granted access earlier; never prompts by itself.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'midi', sysex: true } as unknown as PermissionDescriptor)
      .then((s) => {
        if (!cancelled && s.state === 'granted') void enable();
      })
      .catch(() => undefined); // browsers without the MIDI permission name keep the manual button
    return () => {
      cancelled = true;
    };
  }, [enable]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      link.current?.close();
    },
    [],
  );

  // The pedal reports what is played on it. A preset switch is re-read so edits never land on a
  // preset the screen does not show; knobs and block switches update the screen directly.
  notifyRef.current = (f: Frame) => {
    if (busyRef.current) return; // a save or restore is driving the pedal
    const flag = modifiedFlag(f);
    if (flag !== null) {
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

  const keepBackup = useCallback(
    (file: BackupFile) => {
      const { list, stored } = storeBackup(backupsRef.current, file);
      backupsRef.current = list;
      setState((s) => ({
        ...s,
        backups: list,
        flowBackups: [...s.flowBackups, file],
        storageWarning: stored ? s.storageWarning : 'This browser could not keep the backup. Download it now and keep the file.',
      }));
    },
    [],
  );

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
        busyRef.current = false;
        patch({ busy: null, preset: result.saved, presetIndex: target, restorePoint: result.saved, names });
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
    (target: number, name: string, backup = true) =>
      runFlow(target, (pedal, onProgress) =>
        saveToSlot(pedal, { target, name, backup, edited: presetRef.current, onProgress, onBackup: keepBackup }),
      ),
    [runFlow, keepBackup],
  );

  const restore = useCallback(
    (slot: SlotBackup) =>
      runFlow(slot.index, (pedal, onProgress) =>
        restoreFromBackup(pedal, slot, { onProgress, onBackup: keepBackup }),
      ),
    [runFlow, keepBackup],
  );

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
    } catch (e) {
      if (!(e instanceof LinkClosedError)) patch({ error: message(e) });
    }
  }, [patch]);

  /** Loads a preset file into the edit buffer (nothing is saved); Revert still brings back the old one. */
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

  const modified = useMemo(
    () => safeModified(state.preset, state.restorePoint) || state.pedalModified === true,
    [state.preset, state.restorePoint, state.pedalModified],
  );

  return {
    ...state,
    modified,
    enable,
    connect,
    disconnect,
    read,
    edit,
    revert: () => void revert(),
    save,
    restore,
    loadNames,
    loadPreset: (index: number) => void loadPreset(index),
    exclusive,
    refreshSlotNames,
    importBackup,
    exportPreset: () => void exportPreset(),
    importPreset,
    downloadBackup,
    setLiveEdit: (liveEdit: boolean) => patch({ liveEdit }),
    selectInput: (inputId: string) => patch({ inputId }),
    selectOutput: (outputId: string) => patch({ outputId }),
    clearLog: () => patch({ log: [] }),
    showError: (error: string) => patch({ error }),
    clearError: () => patch({ error: null }),
  };
}
