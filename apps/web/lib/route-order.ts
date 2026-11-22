/**
 * The order the tone assistant tries providers in, as the person set it with ↑↓, and the optional
 * rotation: each new conversation starts one provider further down the list (a conversation stays
 * on its provider unless it fails or runs out, then the order applies).
 */
import type { AiModel } from './assistant.ts';

/** The saved order first (for providers that have a key), then any added since, in `available`'s order. */
export function orderRoute(available: readonly AiModel[], saved: readonly string[]): AiModel[] {
  const first = saved.filter((m): m is AiModel => (available as readonly string[]).includes(m));
  return [...new Set([...first, ...available])];
}

/** The order with `model` one place up (-1) or down (1); unchanged at either end. */
export function moveInOrder(order: readonly AiModel[], model: AiModel, delta: -1 | 1): AiModel[] {
  const from = order.indexOf(model);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** The route starting `offset` places further, wrapping around. */
export function rotated(route: readonly AiModel[], offset: number): AiModel[] {
  if (route.length === 0) return [];
  const o = ((offset % route.length) + route.length) % route.length;
  return [...route.slice(o), ...route.slice(0, o)];
}
