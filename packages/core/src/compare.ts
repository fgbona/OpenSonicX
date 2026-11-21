/**
 * What differs between two presets, in the terms the editor shows: chain order, models, on/off,
 * parameter values and the preset volume. Used before loading a preset file over the current one.
 */
import type { Preset } from './dump.ts';

export type Difference =
  | { readonly what: 'order' | 'volume'; readonly from: string; readonly to: string }
  | { readonly block: string; readonly what: 'model' | 'on'; readonly from: string; readonly to: string }
  | { readonly block: string; readonly what: 'param'; readonly name: string; readonly from: string; readonly to: string };

const order = (p: Preset) => p.chain.map((b) => b.label).join(' ');

/** Differences from `from` to `to`, blocks in `to`'s chain order. */
export function comparePresets(from: Preset, to: Preset): Difference[] {
  const out: Difference[] = [];
  if (order(from) !== order(to)) out.push({ what: 'order', from: order(from), to: order(to) });
  for (const b of to.chain) {
    const a = from.chain.find((x) => x.module === b.module);
    if (!a) continue;
    // A different model (or AMP switching to a captured profile) has different parameters.
    if (a.code !== b.code || (b.key === 'amp' && from.ampMode !== to.ampMode)) {
      out.push({ block: b.label, what: 'model', from: a.model, to: b.model });
    } else {
      for (const p of b.params) {
        const q = a.params.find((x) => x.alg === p.alg);
        if (q && q.value !== p.value) out.push({ block: b.label, what: 'param', name: p.name, from: q.display, to: p.display });
      }
    }
    if (a.on !== b.on) out.push({ block: b.label, what: 'on', from: a.on ? 'on' : 'off', to: b.on ? 'on' : 'off' });
  }
  if (from.volume !== to.volume) out.push({ what: 'volume', from: String(from.volume ?? '-'), to: String(to.volume ?? '-') });
  return out;
}
