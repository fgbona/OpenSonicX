'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdit, decodeCurrentPreset, decodePreset, diffPresets, editToCommands, MessageType, Query,
  type Edit, type Frame, type Preset,
} from '@pocket-master/core';
import { LinkClosedError, openMidi, pickPocketMaster, PocketMasterLink, type LogEntry } from './midi';

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
}

const INITIAL: PocketMasterState = {
  status: 'idle', error: null, inputs: [], outputs: [], inputId: '', outputId: '',
  preset: null, presetIndex: null, restorePoint: null, liveEdit: false, log: [],
};

const toOptions = (ports: Iterable<MIDIPort>): PortOption[] =>
  Array.from(ports, (p) => ({ id: p.id, name: p.name ?? p.id }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True when the pedal itself announced a preset change (footswitch or knob on the unit). */
const isPresetChange = (f: Frame) => f.payload[0] === MessageType.GET && f.payload[1] === Query.CURRENT_PRESET;

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
    settleTimer.current = setTimeout(() => void readRef.current(), SETTLE_MS);
  }, []);

  /** Reads preset number and edit buffer. Resolves with the pedal's preset, or null if stale or failed. */
  const read = useCallback(async (): Promise<Preset | null> => {
    const current = link.current;
    if (!current) return null;
    patch({ status: 'reading', error: null });
    try {
      await current.drained(); // never read while edits are still on their way
      const generation = editGeneration.current;
      const index = decodeCurrentPreset((await current.request(Query.CURRENT_PRESET)).payload);
      const preset = decodePreset((await current.request(Query.EDIT_BUFFER)).payload);
      if (link.current !== current) return null;
      if (editGeneration.current !== generation) {
        // An edit went out while the dump was in flight: this dump is older than the screen.
        scheduleReread();
        return null;
      }
      setState((s) => {
        // A new preset on the pedal gets a new restore point; the same preset keeps the first one.
        const restorePoint = s.restorePoint && s.presetIndex === index ? s.restorePoint : preset;
        restoreRef.current = restorePoint;
        return { ...s, status: 'connected', preset, presetIndex: index, restorePoint };
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
      if (!current || !preset || edits.length === 0) return;
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
        if (edits.some((e) => e.kind === 'model' || e.kind === 'chain')) scheduleReread();
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

  /** Re-reads the pedal first, so Revert also undoes knob turns made on the unit. */
  const revert = useCallback(async () => {
    if (!state.liveEdit || !restoreRef.current) return;
    const fresh = (await read()) ?? presetRef.current;
    const target = restoreRef.current;
    if (!fresh || !target) return;
    send(diffPresets(fresh, target));
    scheduleReread();
  }, [state.liveEdit, read, send, scheduleReread]);

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
    patch({ status: 'connecting', error: null, restorePoint: null, liveEdit: false });
    try {
      await Promise.all([input.open(), output.open()]);
      link.current = new PocketMasterLink(input, output, appendLog, (f) => notifyRef.current(f));
      patch({ status: 'connected', error: null });
      await read();
    } catch (e) {
      console.error('connect failed', e);
      link.current = null;
      patch({ status: 'ready', error: `Could not open the ports: ${message(e)}` });
    } finally {
      connecting.current = false;
    }
  }, [state.inputId, state.outputId, patch, appendLog, read]);

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

  // A preset switched on the pedal: re-read so edits never land on a preset the screen does not show.
  notifyRef.current = (f: Frame) => {
    if (isPresetChange(f)) scheduleReread();
  };

  const modified = useMemo(() => safeModified(state.preset, state.restorePoint), [state.preset, state.restorePoint]);

  return {
    ...state,
    modified,
    enable,
    connect,
    disconnect,
    read,
    edit,
    revert: () => void revert(),
    setLiveEdit: (liveEdit: boolean) => patch({ liveEdit }),
    selectInput: (inputId: string) => patch({ inputId }),
    selectOutput: (outputId: string) => patch({ outputId }),
    clearLog: () => patch({ log: [] }),
  };
}
