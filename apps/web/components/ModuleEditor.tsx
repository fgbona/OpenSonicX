'use client';

import {
  type Block, blockModelLabel, delayMs, type Edit, encodeValue, FOOTSWITCH_CAPACITY, modelInfo, modelLabel, modelOf, modelsFor,
  paramSpecFor, type Preset, TAP_DIVISIONS,
} from '@pocket-master/core';
import { Knob } from './Knob';
import { ModuleIcon } from './ModuleIcon';
import { useI18n } from './I18n';
import { modelValue, parseModelValue, profileChoices } from '@/lib/ampChoices';

interface Props {
  preset: Preset;
  block: Block;
  editable: boolean;
  onEdit: (edit: Edit) => void;
  irNames: readonly (string | null)[] | null;
  profileNames: readonly (string | null)[] | null;
}

const SINGLE_MODEL = new Set(['nr']);
const FOOTSWITCHES = [null, 'fs1', 'fs2'] as const;

/** The selected block: model, on/off, footswitch, every parameter as a knob, switch or list. */
export function ModuleEditor({ preset, block, editable, onEdit, irNames, profileNames }: Props) {
  const { t } = useI18n();
  const model = modelOf(preset, block);
  const clone = block.key === 'amp' && preset.ampMode === 'clone';
  const choices = SINGLE_MODEL.has(block.key) ? [] : modelsFor(block.key);
  const profiles = block.key === 'amp' ? profileChoices(profileNames) : [];
  const shown = blockModelLabel(block, preset.ampMode, irNames, profileNames);
  const info = model && !clone ? modelInfo(block.key, model.name) : undefined;
  const send = (alg: number, input: number | boolean | string) => {
    const spec = paramSpecFor(preset, block, alg);
    if (spec) onEdit({ kind: 'param', module: block.module, alg, value: encodeValue(spec, input) });
  };
  const time = block.key === 'dly' ? block.params.find((p) => p.name === 'Time' && p.kind === 'number') : undefined;

  return (
    <section className={`editor block-${block.key}${block.on ? '' : ' editor-off'}`} aria-label={t('editor.aria', { block: block.label })}>
      <header className="editor-head">
        <ModuleIcon blockKey={block.key} size={36} />
        <span className="editor-label">{block.label}</span>
        {editable && block.key === 'amp' ? (
          <select className="editor-model" aria-label={t('block.modelAria', { block: block.label })} value={modelValue(block.code, clone)}
            onChange={(e) => {
              const choice = parseModelValue(e.target.value);
              if (choice) onEdit({ kind: 'model', module: block.module, code: choice.code, clone: choice.clone });
            }}>
            {clone && shown === block.model && <option value={modelValue(block.code, true)} disabled>{t('block.captured', { model: block.model })}</option>}
            <optgroup label={t('block.ampModels')}>{choices.map((m) => <option key={m.code} value={modelValue(m.code, false)}>{m.name}</option>)}</optgroup>
            {profiles.length > 0 && (
              <optgroup label={t('block.profiles')}>
                {profiles.map((p) => <option key={p.code} value={modelValue(p.code, true)}>{t('block.profileOption', { name: p.name, n: p.slot })}</option>)}
              </optgroup>
            )}
          </select>
        ) : editable && choices.length > 0 ? (
          <select className="editor-model" aria-label={t('block.modelAria', { block: block.label })} value={block.code}
            onChange={(e) => onEdit({ kind: 'model', module: block.module, code: Number(e.target.value) })}>
            {choices.map((m) => <option key={m.code} value={m.code}>{modelLabel(block.key, m.code, m.name, irNames)}</option>)}
          </select>
        ) : (
          <span className="editor-model editor-model-static">{shown}</span>
        )}
        <span className="editor-end">
          <span className="segmented" role="radiogroup" aria-label={t('block.footswitchAria', { block: block.label })}>
            {FOOTSWITCHES.map((fs) => {
              const full = fs !== null && block.footswitch !== fs && preset.chain.filter((b) => b.footswitch === fs).length >= FOOTSWITCH_CAPACITY;
              return (
                <button key={fs ?? 'none'} type="button" role="radio" aria-checked={block.footswitch === fs} className={block.footswitch === fs ? 'is-on' : ''}
                  disabled={!editable || full} onClick={() => onEdit({ kind: 'footswitch', module: block.module, footswitch: fs })}>
                  {fs ? fs.toUpperCase() : t('editor.fsNone')}
                </button>
              );
            })}
          </span>
          <button type="button" role="switch" aria-checked={block.on} aria-label={t(block.on ? 'block.onAria' : 'block.offAria', { block: block.label })}
            className={`switch${block.on ? ' switch-on' : ''}`} disabled={!editable} onClick={() => onEdit({ kind: 'on', module: block.module, on: !block.on })}>
            <span className="switch-knob" />
          </button>
        </span>
      </header>
      {block.params.length === 0 ? (
        <p className="muted small">{t('block.noParams')}</p>
      ) : (
        <div className="editor-params">
          {block.params.map((p) => {
            const spec = paramSpecFor(preset, block, p.alg);
            if (p.kind === 'number' && spec) {
              return <Knob key={p.alg} label={p.name} value={p.value} min={p.min ?? 0} max={p.max ?? 100} step={spec.step ?? 1}
                display={p.display} defaultValue={spec.default} disabled={!editable} onChange={(v) => send(p.alg, v)} />;
            }
            if (p.kind === 'switch') {
              const on = p.value >= 0.5;
              return (
                <div key={p.alg} className="editor-toggle">
                  <span className="knob-value" aria-hidden="true">{on ? t('block.on') : t('block.off')}</span>
                  <button type="button" role="switch" aria-checked={on} aria-label={p.name} className={`switch${on ? ' switch-on' : ''}`} disabled={!editable || !spec} onClick={() => send(p.alg, !on)}>
                    <span className="switch-knob" />
                  </button>
                  <span className="knob-label">{p.name}</span>
                </div>
              );
            }
            return (
              <div key={p.alg} className="editor-toggle">
                <span className="knob-value" aria-hidden="true">{p.display}</span>
                <select className="param-select" aria-label={p.name} value={Math.round(p.value)} disabled={!editable || !spec} onChange={(e) => send(p.alg, Number(e.target.value))}>
                  {spec?.options?.map((o, i) => <option key={o} value={i}>{o}</option>)}
                </select>
                <span className="knob-label">{p.name}</span>
              </div>
            );
          })}
        </div>
      )}
      {time && editable && preset.bpm !== null && (
        <div className="editor-tap" role="group" aria-label={t('editor.timeFromBpm', { bpm: preset.bpm })}>
          <span className="muted small">{t('editor.timeFromBpm', { bpm: preset.bpm })}</span>
          {TAP_DIVISIONS.map((d) => (
            <button key={d.label} type="button" className="btn btn-small"
              onClick={() => send(time.alg, Math.min(time.max ?? 1000, Math.max(time.min ?? 20, delayMs(preset.bpm!, d.multiplier))))}>
              {d.label}
            </button>
          ))}
        </div>
      )}
      {(info?.basedOn || info?.about) && (
        <p className="editor-info">{info.basedOn ? t('editor.basedOn', { gear: info.basedOn }) : ''}{info.basedOn && info.about ? ' · ' : ''}{info.about}</p>
      )}
    </section>
  );
}
