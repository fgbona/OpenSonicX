/** Text the assistant reads: the loaded preset, and the models a block offers. */
import { findCloneModel, modelsFor, type ParamSpec } from '../catalog.ts';
import type { Preset } from '../dump.ts';
import { modelInfo } from '../model-info.ts';
import { blockModelLabel } from '../model-label.ts';
import { presetLabel } from '../presets.ts';
import { modelChoices, type SlotNames } from '../resolve.ts';

export function formatPreset(index: number, name: string, preset: Preset, slots: SlotNames, modified: boolean | null): string {
  const head = [
    `${presetLabel(index)} "${name}"`,
    `volume ${preset.volume ?? '?'}`,
    `amp mode: ${preset.ampMode === 'clone' ? 'captured profile' : 'amp model'}`,
    `unsaved changes: ${modified === null ? 'unknown' : modified ? 'yes' : 'no'}`,
  ].join(' · ');
  const chain = `Chain: ${preset.chain.map((b) => b.label).join(' → ')}`;
  const width = Math.max(...preset.chain.map((b) => b.label.length));
  const blocks = preset.chain.map((b) => {
    const model = blockModelLabel(b, preset.ampMode, slots.irNames, slots.profileNames);
    const params = b.params.map((p) => `${p.name} ${p.display}`).join(', ');
    return `${b.label.padEnd(width)}  ${b.on ? 'on ' : 'off'}  ${model}${params ? `: ${params}` : ''}`;
  });
  return [head, chain, ...blocks].join('\n');
}

export function formatModels(blockKey: string, label: string, slots: SlotNames): string {
  const lines = modelChoices(blockKey, slots).map((choice) => {
    const catalogModel = choice.clone ? findCloneModel(choice.code) : modelsFor(blockKey).find((m) => m.code === choice.code);
    const info = catalogModel ? modelInfo(blockKey, catalogModel.name) : undefined;
    const text = [choice.basedOn ? `based on ${choice.basedOn}.` : '', choice.clone ? 'Captured profile loaded on the pedal.' : (info?.about ?? '')].filter(Boolean).join(' ');
    const params = (catalogModel?.params ?? []).map(formatParamSpec).join(', ');
    return `- ${choice.name}${text ? `: ${text}` : ''}${params ? `\n    params: ${params}` : ''}`;
  });
  return `${label} models:\n${lines.join('\n')}`;
}

/**
 * The same choices in one line each, for the chat's first message: the name, what it is based on
 * (or, without one, the short description) and the parameter names, with a range only when it is
 * not 0..100. Groq's free plan allows 8,000 tokens a minute; list_models gives the full text.
 */
export function formatModelsCompact(blockKey: string, label: string, slots: SlotNames): string {
  const lines = modelChoices(blockKey, slots).map((choice) => {
    const catalogModel = choice.clone ? findCloneModel(choice.code) : modelsFor(blockKey).find((m) => m.code === choice.code);
    const about = choice.clone ? 'captured profile' : (choice.basedOn ?? firstSentence(catalogModel ? modelInfo(blockKey, catalogModel.name)?.about : undefined));
    const params = (catalogModel?.params ?? []).map(compactParam).join(', ');
    return `- ${choice.name}${about ? ` (${about.replace(/\.$/, '')})` : ''}${params ? `: ${params}` : ''}`;
  });
  return `${label} models:\n${lines.join('\n')}`;
}

/**
 * A tone's main gear, for the list of kept tones: the drive, amp and cab that are on, each with
 * what it is based on ("AMP A BassVT (Bass amp with 3-band EQ…)"), so a bass tone is not taken
 * for a guitar one by its name.
 */
export function toneGear(preset: Preset): string {
  return preset.chain
    .filter((b) => b.on && (b.key === 'drv' || b.key === 'amp' || b.key === 'ir'))
    .map((b) => {
      const info = modelInfo(b.key, b.model);
      const about = info?.basedOn ?? firstSentence(info?.about);
      return `${b.label} ${b.model}${about ? ` (${about})` : ''}`;
    })
    .join(', ');
}

/** "Bass overdrive with clean blend. Added after…" → "Bass overdrive with clean blend". */
const firstSentence = (text: string | undefined) => text?.split(/[.:;] /)[0];

const compactParam = (p: ParamSpec): string => (p.type === undefined && (p.min ?? 0) === 0 && (p.max ?? 100) === 100 && !p.unit ? p.name : formatParamSpec(p));

export function formatParamSpec(p: ParamSpec): string {
  if (p.type === 'switch') return `${p.name} on/off`;
  if (p.type === 'select') return `${p.name} (${(p.options ?? []).join('/')})`;
  return `${p.name} ${p.min ?? 0}..${p.max ?? 100}${p.unit ? ` ${p.unit}` : ''}`;
}
