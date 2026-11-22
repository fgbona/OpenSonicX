import { comparePresets, type Difference, type Preset } from '@pocket-master/core';

/**
 * What the assistant changed, for the chat: parameter rows name the block's model and say when the
 * block is off (its changes are not heard), and a new model is followed by the values it now has.
 */
export function toneChanges(before: Preset, after: Preset): Difference[] {
  const blockOf = (label: string) => after.chain.find((b) => b.label === label);
  const title = (label: string) => {
    const b = blockOf(label);
    return b ? `${label} · ${b.model}${b.on ? '' : ' (off)'}` : label;
  };
  return comparePresets(before, after).flatMap((d): Difference[] => {
    if (!('block' in d)) return [d];
    if (d.what === 'param') return [{ ...d, block: title(d.block) }];
    if (d.what !== 'model') return [d];
    const values = (blockOf(d.block)?.params ?? []).map((p): Difference => ({ block: title(d.block), what: 'param', name: p.name, from: '–', to: p.display }));
    return [d, ...values];
  });
}
