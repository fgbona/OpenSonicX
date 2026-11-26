/**
 * The rig view's chain for either pedal: one shape (RigBlock) the components draw and edit, made
 * from a Matribox chain or a Pocket Master preset. Values go back through each editor's own
 * handlers (history.setParam / onEdit), so Undo works as in the classic look.
 */
import { encodeValue, modelInfo, modelOf, type MbResolvedBlock, type Preset } from '@pocket-master/core';
import { pmRigCategory, rigCategory, rigIconSpec, type RigIconSpec } from './rigIcon.ts';

export interface RigParam {
  readonly id: number;
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** A list or a switch: the name of each step. */
  readonly options?: readonly string[];
  /** The value as the classic editor writes it ("120 ms"); else the number or the option. */
  readonly shown?: string;
}

export interface RigBlock {
  /** What the handlers address: the Matribox's storage slot, the Pocket Master's module. */
  readonly id: number;
  /** The block in messages: "2. DRV" (Matribox), "DRV" (Pocket Master). */
  readonly name: string;
  readonly module: string;
  readonly model: string;
  /** The real gear the model is modelled on (plain attribution), when the catalog names one. */
  readonly basedOn?: string;
  readonly on: boolean;
  readonly spec: RigIconSpec;
  readonly params: readonly RigParam[];
}

/** The Matribox's chain; `model` names a block as its tile does (mbTileModel). */
export function mbRigBlocks(chain: readonly MbResolvedBlock[], model: (b: MbResolvedBlock) => string): RigBlock[] {
  return chain.map((b) => {
    const name = model(b);
    return {
      id: b.slot,
      name: `${b.position}. ${b.module}`,
      module: b.module,
      model: name,
      // A user IR or capture plays the person's own file: no model attribution.
      basedOn: (b.module === 'IR' || b.module === 'CLONE' ? undefined : b.model?.basedOn?.trim()) || undefined,
      on: b.on,
      spec: rigIconSpec(rigCategory(b), `${b.moduleIndex}:${b.fxid}`, b.params.length, name),
      params: b.params.map((p) => {
        const spec = b.model?.params.find((m) => m.id === p.id);
        return { id: p.id, name: p.name, value: Number.isFinite(p.value) ? p.value : p.min, min: p.min, max: p.max, step: spec?.step && spec.step > 0 ? spec.step : 1, options: spec?.options };
      }),
    };
  });
}

/**
 * The Pocket Master's chain. `model` names a block as its tile does (blockModelLabel), `onOff` the
 * two states of a switch parameter in the page's language.
 */
export function pmRigBlocks(preset: Preset, model: (b: Preset['chain'][number]) => string, onOff: readonly [string, string]): RigBlock[] {
  return preset.chain.map((b) => {
    const found = modelOf(preset, b);
    const specs = found?.params ?? [];
    const name = model(b);
    const clone = b.key === 'amp' && preset.ampMode === 'clone';
    return {
      id: b.module,
      name: b.label,
      module: b.label,
      model: name,
      basedOn: (found && !clone ? modelInfo(b.key, found.name)?.basedOn : undefined) || undefined,
      on: b.on,
      spec: rigIconSpec(pmRigCategory(b, preset.ampMode), `${b.key}:${b.code}`, b.params.length, name),
      params: b.params.map((p) => {
        const spec = specs.find((s) => s.alg === p.alg);
        if (p.kind === 'switch') return { id: p.alg, name: p.name, value: p.value >= 0.5 ? 1 : 0, min: 0, max: 1, step: 1, options: onOff };
        if (p.kind === 'select') {
          const options = spec?.options ?? [];
          return { id: p.alg, name: p.name, value: Math.round(p.value), min: 0, max: Math.max(0, options.length - 1), step: 1, options };
        }
        return { id: p.alg, name: p.name, value: p.value, min: p.min ?? 0, max: p.max ?? 100, step: spec?.step ?? 1, shown: p.display };
      }),
    };
  });
}

/** What a Pocket Master parameter edit sends for a bar's value, or null when the model is unknown. */
export function pmParamValue(preset: Preset, module: number, alg: number, value: number): number | null {
  const block = preset.chain.find((b) => b.module === module);
  const spec = block && modelOf(preset, block)?.params.find((s) => s.alg === alg);
  return spec ? encodeValue(spec, value) : null;
}
