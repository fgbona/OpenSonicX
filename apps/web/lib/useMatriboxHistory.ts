'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MbPreset } from '@pocket-master/core';
import { EMPTY_HISTORY, record, redo as redoStep, undo as undoStep, type History } from './history';
import type { MbChainBlock } from './matriboxPlan';
import type { Matribox } from './useMatribox';

/**
 * Undo and Redo for the Matribox editor's live edits (values, on/off, models, add, move, remove,
 * and each assistant answer as one step). A step back or forward is sent as the writes that turn
 * the chain the unit holds into the one kept (matriboxOps.ts `applyChain`): the same validated writes.
 */
export function useMatriboxHistory(mb: Matribox) {
  const [history, setHistory] = useState<History<MbPreset>>(EMPTY_HISTORY);
  const historyRef = useRef<History<MbPreset>>(EMPTY_HISTORY);
  /** The preset on screen; also set right after a write, before React renders it (the assistant reads it next). */
  const presetRef = useRef<MbPreset | null>(null);
  presetRef.current = mb.unit?.preset ?? null;
  const { apply } = mb;

  const commit = useCallback((next: History<MbPreset>) => {
    historyRef.current = next;
    setHistory(next);
  }, []);
  const push = useCallback((before: MbPreset, key: string | null) => commit(record(historyRef.current, before, key, Date.now())), [commit]);

  // Another preset loaded: the steps were edits of the one before.
  const current = mb.unit?.current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: current is the trigger (another preset loaded)
  useEffect(() => commit(EMPTY_HISTORY), [current, commit]);

  /** Sends `target`'s chain (planned from what the unit holds); the preset as the unit has it, or why it was refused (the error also shows). */
  const send = useCallback(
    async (target: readonly MbChainBlock[]): Promise<{ readonly preset: MbPreset } | { readonly error: string }> => {
      if (!presetRef.current) return { error: 'No preset is loaded.' };
      const result = await apply(target);
      if ('preset' in result) presetRef.current = result.preset;
      return result;
    },
    [apply],
  );

  /** One Undo or Redo at a time: a key held down must not read the history before the last step is kept. */
  const stepping = useRef(false);
  const step = useCallback(
    async (back: boolean): Promise<boolean> => {
      const now = presetRef.current;
      const moved = now && !stepping.current ? (back ? undoStep : redoStep)(historyRef.current, now) : null;
      if (!moved) return false;
      stepping.current = true;
      try {
        if (!('preset' in (await send(moved.target.chain)))) return false;
        commit(moved.history);
        return true;
      } finally {
        stepping.current = false;
      }
    },
    [send, commit],
  );

  /** Runs a chain edit and records it once the unit took it. */
  const recorded = useCallback(
    async (act: () => Promise<boolean>, key: string | null = null) => {
      const before = presetRef.current;
      if (before && (await act())) push(before, key);
    },
    [push],
  );

  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo: useCallback(() => step(true), [step]),
    redo: useCallback(() => step(false), [step]),
    preset: () => presetRef.current,
    setParam: (slot: number, id: number, value: number) => {
      if (presetRef.current) push(presetRef.current, `param:${slot}:${id}`); // a knob drag merges into one step
      mb.setParam(slot, id, value);
    },
    setOn: (slot: number, on: boolean) => recorded(() => mb.setOn(slot, on)),
    changeModel: (slot: number, moduleIndex: number, fxid: number) => recorded(() => mb.changeModel(slot, moduleIndex, fxid)),
    addBlock: (position: number, moduleIndex: number, fxid: number) => recorded(() => mb.addBlock(position, moduleIndex, fxid)),
    moveBlock: (from: number, to: number) => recorded(() => mb.moveBlock(from, to)),
    removeBlock: (position: number) => recorded(() => mb.removeBlock(position)),
    /** The assistant's chain, as one step; throws when the editor refused it. */
    applyChain: async (chain: readonly MbChainBlock[]): Promise<MbPreset> => {
      const before = presetRef.current;
      const result = await send(chain);
      if ('error' in result) throw new Error(result.error);
      if (before) push(before, null);
      return result.preset;
    },
  };
}

export type MatriboxHistory = ReturnType<typeof useMatriboxHistory>;
