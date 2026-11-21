'use client';

/**
 * Gemini's free tier counts requests per project per Pacific day and its API does not report what
 * is left, so the editor counts the requests it makes itself. An estimate: the same key used
 * elsewhere is not seen. Stored per model in localStorage.
 */
import { useSyncExternalStore } from 'react';

import type { AiModel } from './assistant.ts';

export type { AiModel };
export type Usage = Readonly<Partial<Record<AiModel, { readonly day: string; readonly count: number }>>>;

const KEY = 'pocket-master-editor.geminiUsage.v1';
const ZONE = 'America/Los_Angeles';

/** The Pacific calendar day of an instant, YYYY-MM-DD. */
export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Minutes the Pacific clock is behind UTC at an instant (480 in winter, 420 in summer). */
function pacificOffset(at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return Math.round((at.getTime() - Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!)) / 60_000);
}

/** When the daily quota resets: the next midnight in the Pacific time zone. */
export function nextReset(now: Date): Date {
  const [y, m, d] = pacificDay(now).split('-').map(Number) as [number, number, number];
  const midnight = Date.UTC(y, m - 1, d + 1);
  // The offset at that midnight, not now: a DST change can fall in between.
  return new Date(midnight + pacificOffset(new Date(midnight + pacificOffset(now) * 60_000)) * 60_000);
}

export function countRequest(usage: Usage, model: AiModel, now: Date): Usage {
  const day = pacificDay(now);
  const current = usage[model];
  return { ...usage, [model]: { day, count: current?.day === day ? current.count + 1 : 1 } };
}

export function usedToday(usage: Usage, model: AiModel, now: Date): number {
  const current = usage[model];
  return current?.day === pacificDay(now) ? current.count : 0;
}

export function parseUsage(raw: string | null): Usage {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([k, v]) =>
      (k === 'groq' || k === 'flash' || k === 'lite') && typeof v?.day === 'string' && Number.isInteger(v?.count))) as Usage;
  } catch {
    return {};
  }
}

let cache: Usage | null = null;
const listeners = new Set<() => void>();
const EMPTY: Usage = {};

function current(): Usage {
  if (cache === null) {
    try {
      cache = parseUsage(localStorage.getItem(KEY));
    } catch {
      cache = {};
    }
  }
  return cache;
}

/** Counts one request to `model` now and tells the components showing the meter. */
export function recordRequest(model: AiModel): void {
  cache = countRequest(current(), model, new Date());
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage blocked: counted for this page only
  }
  listeners.forEach((l) => l());
}

export function useAiUsage(): Usage {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, current, () => EMPTY);
}
