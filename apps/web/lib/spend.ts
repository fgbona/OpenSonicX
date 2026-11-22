'use client';

/**
 * What the paid providers cost today, estimated (prices.ts), kept on this device per local day.
 * Only a hint for the person: the provider's own dashboard has the real figure.
 */
import type { AiModel } from './assistant.ts';

const KEY = 'pocket-master-editor.aiSpend.v1';
type Spend = { readonly day: string; readonly usd: Readonly<Partial<Record<AiModel, number>>> };

const localDay = (now: Date) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

function load(now: Date): Spend {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Spend | null;
    return s && s.day === localDay(now) && typeof s.usd === 'object' ? s : { day: localDay(now), usd: {} };
  } catch {
    return { day: localDay(now), usd: {} };
  }
}

export function spentToday(model: AiModel, now = new Date()): number {
  return load(now).usd[model] ?? 0;
}

export function recordSpend(model: AiModel, usd: number, now = new Date()): void {
  const s = load(now);
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: s.day, usd: { ...s.usd, [model]: (s.usd[model] ?? 0) + usd } }));
  } catch {
    // not kept: the estimate then covers this page only
  }
}
