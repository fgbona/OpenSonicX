'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdit, decodeCurrentPreset, decodePreset, diffPresets, editToCommands, Query, type Edit, type Preset,
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

/** Queue key: a newer edit with the same key replaces a pending one. */
const editKey = (e: Edit) =>
  e.kind === 'param' ? `param:${e.module}:${e.alg}` : e.kind === 'on' ? `on:${e.module}` : e.kind === 'model' ? `model:${e.module}` : 'chain';

export function usePocketMaster() {
  const [state, setState] = useState<PocketMasterState>(INITIAL);
  const access = useRef<MIDIAccess | null>(null);
  const link = useRef<PocketMasterLink | null>(null);
  const connecting = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Edits are computed from the latest preset, not from a stale render.
  const presetRef = useRef<Preset | null>(null);
  presetRef.current = state.preset;

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

  const read = useCallback(async () => {
    const current = link.current;
    if (!current) return;
    patch({ status: 'reading', error: null });
    try {
      await current.drained(); // never read while edits are still on their way
      const index = decodeCurrentPreset((await current.request(Query.CURRENT_PRESET)).payload);
      const preset = decodePreset((await current.request(Query.EDIT_BUFFER)).payload);
      if (link.current !== current) return;
      setState((s) => ({
        ...s,
        status: 'connected',
        preset,
        presetIndex: index,
        // A new preset on the pedal gets a new restore point; the same preset keeps the first one.
        restorePoint: s.restorePoint && s.presetIndex === index ? s.restorePoint : preset,
      }));
    } catch (e) {
      // A read from a link that was closed or replaced must not touch the current state.
      if (e instanceof LinkClosedError || link.current !== current) return;
      console.error('read failed', e);
      patch({ status: 'connected', error: message(e) });
    }
  }, [patch]);

  const scheduleReread = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => void read(), SETTLE_MS);
  }, [read]);

  /** Applies edits to the screen at once and queues them for the pedal. */
  const send = useCallback(
    (edits: readonly Edit[]) => {
      const current = link.current;
      const preset = presetRef.current;
      if (!current || !preset || edits.length === 0) return;
      try {
        const next = edits.reduce((p, e) => {
          editToCommands(p, e).forEach((bytes, i) => current.edit(`${editKey(e)}#${i}`, bytes));
          return applyEdit(p, e);
        }, preset);
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

  const revert = useCallback(() => {
    const preset = presetRef.current;
    if (!state.liveEdit || !preset || !state.restorePoint) return;
    send(diffPresets(preset, state.restorePoint));
    scheduleReread();
  }, [state.liveEdit, state.restorePoint, send, scheduleReread]);

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
    patch({ status: 'connecting', error: null, restorePoint: null, liveEdit: false });
    try {
      await Promise.all([input.open(), output.open()]);
      link.current = new PocketMasterLink(input, output, appendLog);
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

  const modified = useMemo(
    () => (state.preset && state.restorePoint ? diffPresets(state.preset, state.restorePoint).length > 0 : false),
    [state.preset, state.restorePoint],
  );

  return {
    ...state,
    modified,
    enable,
    connect,
    disconnect,
    read,
    edit,
    revert,
    setLiveEdit: (liveEdit: boolean) => patch({ liveEdit }),
    selectInput: (inputId: string) => patch({ inputId }),
    selectOutput: (outputId: string) => patch({ outputId }),
    clearLog: () => patch({ log: [] }),
  };
}
