'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeCurrentPreset, decodePreset, Query, type Preset } from '@pocket-master/core';
import { openMidi, pickPocketMaster, PocketMasterLink, type LogEntry } from './midi';

export const LOG_LIMIT = 2000;

export type Status = 'idle' | 'requesting' | 'ready' | 'connected' | 'reading';

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
  readonly log: readonly LogEntry[];
}

const toOptions = (ports: Iterable<MIDIPort>): PortOption[] =>
  Array.from(ports, (p) => ({ id: p.id, name: p.name ?? p.id }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function usePocketMaster() {
  const [state, setState] = useState<PocketMasterState>({
    status: 'idle', error: null, inputs: [], outputs: [], inputId: '', outputId: '', preset: null, presetIndex: null, log: [],
  });
  const access = useRef<MIDIAccess | null>(null);
  const link = useRef<PocketMasterLink | null>(null);
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
      inputId: inputs.some((p) => p.id === s.inputId) ? s.inputId : (pickPocketMaster(inputs)?.id ?? inputs[0]?.id ?? ''),
      outputId: outputs.some((p) => p.id === s.outputId) ? s.outputId : (pickPocketMaster(outputs)?.id ?? outputs[0]?.id ?? ''),
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
      const index = decodeCurrentPreset((await current.request(Query.CURRENT_PRESET)).payload);
      const preset = decodePreset((await current.request(Query.EDIT_BUFFER)).payload);
      patch({ status: 'connected', preset, presetIndex: index });
    } catch (e) {
      console.error('read failed', e);
      patch({ status: 'connected', error: message(e) });
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
    link.current?.close();
    try {
      await Promise.all([input.open(), output.open()]);
      link.current = new PocketMasterLink(input, output, appendLog);
      patch({ status: 'connected', error: null });
      await read();
    } catch (e) {
      console.error('connect failed', e);
      link.current = null;
      patch({ status: 'ready', error: `Could not open the ports: ${message(e)}` });
    }
  }, [state.inputId, state.outputId, patch, appendLog, read]);

  const disconnect = useCallback(() => {
    link.current?.close();
    link.current = null;
    patch({ status: 'ready' });
  }, [patch]);

  useEffect(() => () => link.current?.close(), []);

  return {
    ...state,
    enable,
    connect,
    disconnect,
    read,
    selectInput: (inputId: string) => patch({ inputId }),
    selectOutput: (outputId: string) => patch({ outputId }),
    clearLog: () => patch({ log: [] }),
  };
}
