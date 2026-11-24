'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  matriboxLink, mbAddBlock, mbAssignExpression, mbAssignFootswitch, mbChangeModel, mbMoveBlock, mbRemoveBlock, mbSelectPreset, mbSetBlockOn,
  mbSetParam, mbSetPatchVolume, withMbVolume,
  type MatriboxLink, type MbCatalog, type MbExpressionAssignment, type MbPreset, type MidiPort,
} from '@pocket-master/core';
import { readLoaded, readUnit, saveToSlot, serialQueue, withBlockOn, withParam, type MbBackup, type MbUnit } from './matribox';
import { applyOps } from './matriboxOps';
import type { MbOp } from './matriboxPlan';
import { keepMbBackup, loadMbBackups, storeMbBackups } from './matriboxBackups';
import { forgetCatalog, loadDesktopCatalog, loadStoredCatalog, parseCatalogText, storeCatalog } from './matriboxCatalog';

export interface MatriboxState {
  readonly unit: MbUnit | null;
  readonly catalog: MbCatalog | null;
  /** Why the picked or installed catalog could not be read. */
  readonly catalogError: string | null;
  /** What runs now ("Saving", …); edits wait meanwhile. */
  readonly busy: string | null;
  readonly error: string | null;
  /** Live edits since the preset was loaded or saved: loading another one asks first. */
  readonly edited: boolean;
  readonly backups: readonly MbBackup[];
  /** Set when the browser would not keep a backup: it must be downloaded. */
  readonly storageWarning: boolean;
}

const INITIAL: MatriboxState = { unit: null, catalog: null, catalogError: null, busy: null, error: null, edited: false, backups: [], storageWarning: false };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The Matribox II Pro editor's state and actions over its open MIDI ports. */
export function useMatribox(port: MidiPort | null, desktop: boolean) {
  const [state, setState] = useState<MatriboxState>(INITIAL);
  const patch = useCallback((p: Partial<MatriboxState>) => setState((s) => ({ ...s, ...p })), []);
  const link = useMemo<MatriboxLink | null>(() => (port ? matriboxLink(port) : null), [port]);
  const queue = useMemo(serialQueue, [link]);
  /** Latest value per parameter not sent yet: a knob drag sends only the newest value. */
  const pending = useRef(new Map<string, { slot: number; id: number; value: number }>());
  const backupsRef = useRef<readonly MbBackup[]>([]);

  /** Runs a step on the unit, one at a time; false when it failed (the error is shown). */
  const run = useCallback((busy: string | null, step: (unit: MatriboxLink) => Promise<void>): Promise<boolean> => {
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
  }, [link, queue, patch]);

  const reloadLoaded = useCallback(async (unit: MatriboxLink) => {
    const loaded = await readLoaded(unit);
    setState((s) => ({ ...s, unit: s.unit ? { ...s.unit, ...loaded } : s.unit }));
  }, []);

  const refresh = useCallback(() => run('Reading', async (unit) => patch({ unit: await readUnit(unit), edited: false })), [run, patch]);

  useEffect(() => {
    if (link) void refresh();
    else setState((s) => ({ ...s, unit: null, busy: null, error: null }));
  }, [link, refresh]);

  // The catalog: the installed one in the desktop app, else the one picked in this browser.
  useEffect(() => {
    backupsRef.current = loadMbBackups();
    patch({ backups: backupsRef.current });
    let cancelled = false;
    void (async () => {
      const text = (desktop ? await loadDesktopCatalog() : null) ?? (await loadStoredCatalog());
      if (cancelled || text === null) return;
      try {
        patch({ catalog: parseCatalogText(text), catalogError: null });
      } catch (e) {
        patch({ catalogError: message(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [desktop, patch]);

  const pickCatalog = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const catalog = parseCatalogText(text);
      await storeCatalog(text).catch((e: unknown) => console.error('could not keep the catalog in this browser', e));
      patch({ catalog, catalogError: null });
    } catch (e) {
      patch({ catalogError: message(e) });
    }
  }, [patch]);

  const dropCatalog = useCallback(async () => {
    await forgetCatalog().catch((e: unknown) => console.error('could not forget the catalog', e));
    patch({ catalog: null, catalogError: null });
  }, [patch]);

  const select = useCallback((index: number) => run('Loading', async (unit) => {
    await unit.write(mbSelectPreset(index));
    await reloadLoaded(unit);
    patch({ edited: false });
  }), [run, reloadLoaded, patch]);

  const setParam = useCallback((slot: number, id: number, value: number) => {
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
  }, [run]);

  const setOn = useCallback((slot: number, on: boolean) => {
    setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: withBlockOn(s.unit.preset, slot, on) } : s.unit }));
    return run(null, (unit) => unit.write(mbSetBlockOn(slot, on)));
  }, [run]);

  /** Latest patch volume not sent yet: a slider drag sends only the newest value. */
  const pendingVolume = useRef<number | null>(null);
  const setVolume = useCallback((volume: number) => {
    setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: withMbVolume(s.unit.preset, volume) } : s.unit }));
    const queued = pendingVolume.current !== null;
    pendingVolume.current = volume;
    if (queued) return;
    void run(null, async (unit) => {
      const latest = pendingVolume.current;
      pendingVolume.current = null;
      if (latest !== null) await unit.write(mbSetPatchVolume(latest));
    });
  }, [run]);

  /** An assignment write (footswitch, expression), then the loaded preset is read again to show what the unit holds. */
  const assign = useCallback((frames: () => readonly Uint8Array[]) => run('Editing', async (unit) => {
    for (const frame of frames()) await unit.write(frame);
    await reloadLoaded(unit);
    patch({ edited: true });
  }), [run, reloadLoaded, patch]);

  /** MIDI Control Changes (tuner, tempo): the unit sends no answer. */
  const control = useCallback((messages: () => readonly Uint8Array[]) => run(null, async (unit) => {
    messages().forEach((m) => unit.control(m));
  }), [run]);

  /** A chain edit, then the loaded preset is read again: the unit picks slots and loads defaults. */
  const chainEdit = useCallback((frame: () => Uint8Array) => run('Editing', async (unit) => {
    await unit.write(frame());
    await reloadLoaded(unit);
    patch({ edited: true });
  }), [run, reloadLoaded, patch]);

  /** Chain-position writes (Undo, Redo, the assistant) as one step; the preset as the unit has it, null when it failed. */
  const apply = useCallback(async (ops: readonly MbOp[]): Promise<MbPreset | null> => {
    let preset: MbPreset | null = null;
    const ok = await run('Editing', async (unit) => {
      const done = await applyOps(unit, ops);
      preset = done;
      setState((s) => ({ ...s, edited: true, unit: s.unit ? { ...s.unit, preset: done } : s.unit }));
    });
    return ok ? preset : null;
  }, [run]);

  const save = useCallback((index: number, name: string) => run('Saving', async (unit) => {
    const keep = (backup: MbBackup) => {
      backupsRef.current = keepMbBackup(backupsRef.current, backup);
      patch({ backups: backupsRef.current, storageWarning: !storeMbBackups(backupsRef.current) });
    };
    await saveToSlot(unit, index, name, keep);
    patch({ unit: await readUnit(unit), edited: false });
  }), [run, patch]);

  return {
    ...state,
    refresh,
    pickCatalog,
    dropCatalog,
    select,
    setParam,
    setOn,
    changeModel: (slot: number, moduleIndex: number, fxid: number) => chainEdit(() => mbChangeModel(slot, moduleIndex, fxid)),
    addBlock: (position: number, moduleIndex: number, fxid: number) => chainEdit(() => mbAddBlock(position, moduleIndex, fxid)),
    moveBlock: (from: number, to: number) => chainEdit(() => mbMoveBlock(from, to)),
    removeBlock: (position: number) => chainEdit(() => mbRemoveBlock(position)),
    setVolume,
    assignFootswitch: (footswitch: number, slot: number, on: boolean) => assign(() => [mbAssignFootswitch(footswitch, slot, on)]),
    assignExpression: (a: MbExpressionAssignment) => assign(() => [mbAssignExpression(a)]),
    control,
    apply,
    save,
    clearError: () => patch({ error: null }),
  };
}

export type Matribox = ReturnType<typeof useMatribox>;
