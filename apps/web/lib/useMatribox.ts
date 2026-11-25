'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  matriboxLink,
  mbAddBlock,
  mbExpressionWrites,
  mbAssignFootswitch,
  mbBackupAllPresets,
  mbChangeModel,
  mbMoveBlock,
  mbReadEditBuffer,
  mbRemoveBlock,
  mbRestoreAllPresets,
  mbSelectPreset,
  mbSetBlockOn,
  mbSetParam,
  mbSetPatchVolume,
  parseMbPreset,
  withMbVolume,
  type MatriboxLink,
  type MbBackupAll,
  type MbExpressionAssignment,
  type MbPreset,
  type MbProgress,
  type MidiPort,
  type Progress,
} from '@pocket-master/core';
import { readLoaded, readUnit, saveToSlot, serialQueue, withBlockOn, withNotice, withParam, type MbBackup, type MbUnit } from './matribox';
import { applyOps } from './matriboxOps';
import type { MbOp } from './matriboxPlan';
import { keepMbBackup, loadMbBackups, storeMbBackups } from './matriboxBackups';
import { importToSlot } from './matriboxPresetFile';

export interface MatriboxState {
  readonly unit: MbUnit | null;
  /** What runs now ("Saving", …); edits wait meanwhile. */
  readonly busy: string | null;
  readonly error: string | null;
  /** Live edits since the preset was loaded or saved: loading another one asks first. */
  readonly edited: boolean;
  readonly backups: readonly MbBackup[];
  /** Set when the browser would not keep a backup: it must be downloaded. */
  readonly storageWarning: boolean;
  /** Backup all / restore all: how far it got ("Backing up 12A", "Restoring 12A"). */
  readonly progress: Progress | null;
}

const INITIAL: MatriboxState = { unit: null, busy: null, error: null, edited: false, backups: [], storageWarning: false, progress: null };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The Matribox II Pro editor's state and actions over its open MIDI ports. */
export function useMatribox(port: MidiPort | null) {
  const [state, setState] = useState<MatriboxState>(INITIAL);
  const patch = useCallback((p: Partial<MatriboxState>) => setState((s) => ({ ...s, ...p })), []);
  const link = useMemo<MatriboxLink | null>(() => (port ? matriboxLink(port) : null), [port]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: link is the trigger (every link gets its own queue)
  const queue = useMemo(serialQueue, [link]);
  /** Latest value per parameter not sent yet: a knob drag sends only the newest value. */
  const pending = useRef(new Map<string, { slot: number; id: number; value: number }>());
  const backupsRef = useRef<readonly MbBackup[]>([]);

  /** Runs a step on the unit, one at a time; false when it failed (the error is shown). */
  const run = useCallback(
    (busy: string | null, step: (unit: MatriboxLink) => Promise<void>): Promise<boolean> => {
      if (!link) return Promise.resolve(false);
      return queue(async () => {
        if (busy) patch({ busy, error: null });
        try {
          await step(link);
          return true;
        } catch (e) {
          console.error(`Matribox: ${busy ?? 'edit'} failed`, e);
          patch({ error: message(e) });
          return false;
        } finally {
          if (busy) patch({ busy: null });
        }
      });
    },
    [link, queue, patch],
  );

  const reloadLoaded = useCallback(async (unit: MatriboxLink) => {
    const loaded = await readLoaded(unit);
    setState((s) => ({ ...s, unit: s.unit ? { ...s.unit, ...loaded } : s.unit }));
  }, []);

  const refresh = useCallback(() => run('Reading', async (unit) => patch({ unit: await readUnit(unit), edited: false })), [run, patch]);

  // Follow what is done on the unit itself: another preset loaded (read again), blocks, knobs, volume.
  const currentRef = useRef<number | null>(null);
  const current = state.unit?.current ?? null;
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    if (!link) return;
    link.onNotice((notice) => {
      if (notice.kind === 'edited') return patch({ edited: notice.edited });
      if (notice.kind !== 'preset') {
        setState((s) => (s.unit ? { ...s, edited: true, unit: { ...s.unit, preset: withNotice(s.unit.preset, notice) } } : s));
        return;
      }
      if (notice.index === currentRef.current) return; // the unit sends it twice
      currentRef.current = notice.index;
      void run('Loading', async (unit) => {
        await reloadLoaded(unit);
        patch({ edited: false });
      });
    });
    return () => link.onNotice(null);
  }, [link, run, reloadLoaded, patch]);

  useEffect(() => {
    if (link) void refresh();
    else setState((s) => ({ ...s, unit: null, busy: null, error: null }));
  }, [link, refresh]);

  useEffect(() => {
    backupsRef.current = loadMbBackups();
    patch({ backups: backupsRef.current });
    // The catalog is built in now: drop the alg_data.json older versions kept in this browser (its only use of IndexedDB).
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('pocket-master-editor');
  }, [patch]);

  const select = useCallback(
    (index: number) =>
      run('Loading', async (unit) => {
        await unit.write(mbSelectPreset(index));
        await reloadLoaded(unit);
        patch({ edited: false });
      }),
    [run, reloadLoaded, patch],
  );

  const setParam = useCallback(
    (slot: number, id: number, value: number) => {
      setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: withParam(s.unit.preset, slot, id, value) } : s.unit }));
      const key = `${slot}:${id}`;
      const queued = pending.current.has(key);
      pending.current.set(key, { slot, id, value });
      if (queued) return;
      void run(null, async (unit) => {
        const latest = pending.current.get(key);
        pending.current.delete(key);
        if (latest) await unit.write(mbSetParam(latest.slot, latest.id, latest.value));
      });
    },
    [run],
  );

  const setOn = useCallback(
    (slot: number, on: boolean) => {
      setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: withBlockOn(s.unit.preset, slot, on) } : s.unit }));
      return run(null, (unit) => unit.write(mbSetBlockOn(slot, on)));
    },
    [run],
  );

  /** Latest patch volume not sent yet: a slider drag sends only the newest value. */
  const pendingVolume = useRef<number | null>(null);
  const setVolume = useCallback(
    (volume: number) => {
      setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: withMbVolume(s.unit.preset, volume) } : s.unit }));
      const queued = pendingVolume.current !== null;
      pendingVolume.current = volume;
      if (queued) return;
      void run(null, async (unit) => {
        const latest = pendingVolume.current;
        pendingVolume.current = null;
        if (latest !== null) await unit.write(mbSetPatchVolume(latest));
      });
    },
    [run],
  );

  /** An assignment write (footswitch, expression), then the loaded preset is read again to show what the unit holds. */
  const assign = useCallback(
    (frames: () => readonly Uint8Array[]) =>
      run('Editing', async (unit) => {
        for (const frame of frames()) await unit.write(frame);
        await reloadLoaded(unit);
        patch({ edited: true });
      }),
    [run, reloadLoaded, patch],
  );

  /** MIDI Control Changes (tuner, tempo): the unit sends no answer. */
  const control = useCallback(
    (messages: () => readonly Uint8Array[]) =>
      run(null, async (unit) => {
        messages().forEach((m) => unit.control(m));
      }),
    [run],
  );

  /** A chain edit, then the loaded preset is read again: the unit picks slots and loads defaults. */
  const chainEdit = useCallback(
    (frame: () => Uint8Array) =>
      run('Editing', async (unit) => {
        await unit.write(frame());
        await reloadLoaded(unit);
        patch({ edited: true });
      }),
    [run, reloadLoaded, patch],
  );

  /** Chain-position writes (Undo, Redo, the assistant) as one step; the preset as the unit has it, null when it failed. */
  const apply = useCallback(
    async (ops: readonly MbOp[]): Promise<MbPreset | null> => {
      let preset: MbPreset | null = null;
      const ok = await run('Editing', async (unit) => {
        const done = await applyOps(unit, ops);
        preset = done;
        setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: done } : s.unit }));
      });
      return ok ? preset : null;
    },
    [run],
  );

  /** Puts a slot's backup in the list kept in this browser. */
  const keep = useCallback(
    (backup: MbBackup) => {
      backupsRef.current = keepMbBackup(backupsRef.current, backup);
      patch({ backups: backupsRef.current, storageWarning: !storeMbBackups(backupsRef.current) });
    },
    [patch],
  );

  const save = useCallback(
    (index: number, name: string) =>
      run('Saving', async (unit) => {
        await saveToSlot(unit, index, name, keep);
        patch({ unit: await readUnit(unit), edited: false });
      }),
    [run, patch, keep],
  );

  const track = useCallback((verb: 'Backing up' | 'Restoring') => (p: MbProgress) => patch({ progress: { step: `${verb} ${p.label}`, done: p.done, total: p.total } }), [patch]);

  /** After a backup or restore: the progress cleared and the unit read again (a failure here must not hide the first one). */
  const settle = useCallback(
    async (unit: MatriboxLink) => {
      patch({ progress: null });
      try {
        patch({ unit: await readUnit(unit), edited: false });
      } catch (e) {
        console.error('Matribox: could not read the unit again', e);
      }
    },
    [patch],
  );

  /** The loaded preset as the unit plays it now (unsaved edits included), for an export; null when it failed. */
  const readEditBuffer = useCallback(async (): Promise<MbPreset | null> => {
    let preset: MbPreset | null = null;
    await run('Reading', async (unit) => {
      preset = parseMbPreset(await mbReadEditBuffer(unit));
    });
    return preset;
  }, [run]);

  /** Stores a preset from a file in slot `index` (backed up first, read back); the slot stays loaded. False when it failed. */
  const importPreset = useCallback(
    (index: number, preset: MbPreset) =>
      run('Importing', async (unit) => {
        try {
          await importToSlot(unit, index, preset, keep);
        } finally {
          await settle(unit); // the target is loaded now, whatever happened after the select
        }
      }),
    [run, keep, settle],
  );

  /** All 240 presets, each read once loaded; the loaded preset is loaded again (its unsaved edits are lost). Null when it failed. */
  const backupAll = useCallback(async (): Promise<MbBackupAll | null> => {
    let file: MbBackupAll | null = null;
    await run('Backing up', async (unit) => {
      try {
        file = await mbBackupAllPresets(unit, { onProgress: track('Backing up') });
      } finally {
        await settle(unit);
      }
    });
    return file;
  }, [run, track, settle]);

  /** Writes every preset of `file` to its slot, after `before` (the backup-all of the unit, when asked); false when it failed. */
  const restoreAll = useCallback(
    (file: MbBackupAll, before: ((backup: MbBackupAll) => void) | null) =>
      run('Restoring', async (unit) => {
        try {
          if (before) before(await mbBackupAllPresets(unit, { onProgress: track('Backing up') }));
          await mbRestoreAllPresets(unit, file, { onProgress: track('Restoring') });
        } finally {
          await settle(unit);
        }
      }),
    [run, track, settle],
  );

  return {
    ...state,
    refresh,
    select,
    setParam,
    setOn,
    changeModel: (slot: number, moduleIndex: number, fxid: number) => chainEdit(() => mbChangeModel(slot, moduleIndex, fxid)),
    addBlock: (position: number, moduleIndex: number, fxid: number) => chainEdit(() => mbAddBlock(position, moduleIndex, fxid)),
    moveBlock: (from: number, to: number) => chainEdit(() => mbMoveBlock(from, to)),
    removeBlock: (position: number) => chainEdit(() => mbRemoveBlock(position)),
    setVolume,
    assignFootswitch: (footswitch: number, slot: number, on: boolean) => assign(() => [mbAssignFootswitch(footswitch, slot, on)]),
    assignExpression: (a: MbExpressionAssignment) => assign(() => mbExpressionWrites(a)),
    control,
    apply,
    save,
    readEditBuffer,
    importPreset,
    backupAll,
    restoreAll,
    clearError: () => patch({ error: null }),
  };
}

export type Matribox = ReturnType<typeof useMatribox>;
