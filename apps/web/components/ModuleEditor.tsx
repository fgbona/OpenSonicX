'use client';

import {
  type Block, blockModelLabel, type Edit, encodeValue, groupModels, type ModelGroup, modelGuide, modelInfo, modelLabel, modelOf,
  modelsFor, type ModelSpec, paramSpecFor, type Preset,
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

/** The selected block: model, on/off, every parameter as a knob, switch or list. */
export function ModuleEditor({ preset, block, editable, onEdit, irNames, profileNames }: Props) {
  const { t, lang } = useI18n();
  // The pedal's own name first (it is what its screen shows), then what it is in plain words.
  const optionText = (m: ModelSpec) => {
    const name = modelLabel(block.key, m.code, m.name, irNames);
    const g = modelGuide(block.key, m.name);
    return g && g.group !== 'userIr' ? `${name} — ${g.label[lang]}` : name;
  };
  const grouped = (render: (m: ModelSpec) => React.ReactNode, groups: ModelGroup<ModelSpec>[]) =>
    groups.length === 1 ? groups[0]!.models.map(render) : groups.map((g) => <optgroup key={g.name ?? 'other'} label={g.name ?? t('block.otherModels')}>{g.models.map(render)}</optgroup>);
  const model = modelOf(preset, block);
  const guide = model ? modelGuide(block.key, model.name) : undefined;
  const clone = block.key === 'amp' && preset.ampMode === 'clone';
  const choices = SINGLE_MODEL.has(block.key) ? [] : modelsFor(block.key);
  const profiles = block.key === 'amp' ? profileChoices(profileNames) : [];
  const shown = blockModelLabel(block, preset.ampMode, irNames, profileNames);
  const info = model && !clone ? modelInfo(block.key, model.name) : undefined;
  const send = (alg: number, input: number | boolean | string) => {
    const spec = paramSpecFor(preset, block, alg);
    if (spec) onEdit({ kind: 'param', module: block.module, alg, value: encodeValue(spec, input) });
  };

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
            {grouped((m) => <option key={m.code} value={modelValue(m.code, false)}>{optionText(m)}</option>, groupModels(block.key, choices, lang))}
            {profiles.length > 0 && (
              <optgroup label={t('block.profiles')}>
                {profiles.map((p) => <option key={p.code} value={modelValue(p.code, true)}>{t('block.profileOption', { name: p.name, n: p.slot })}</option>)}
              </optgroup>
            )}
          </select>
        ) : editable && choices.length > 0 ? (
          <select className="editor-model" aria-label={t('block.modelAria', { block: block.label })} value={block.code}
            onChange={(e) => onEdit({ kind: 'model', module: block.module, code: Number(e.target.value) })}>
            {grouped((m) => <option key={m.code} value={m.code}>{optionText(m)}</option>, groupModels(block.key, choices, lang))}
          </select>
        ) : (
          <span className="editor-model editor-model-static">{shown}</span>
        )}
        <span className="editor-end">
          <button type="button" role="switch" aria-checked={block.on} aria-label={t(block.on ? 'block.onAria' : 'block.offAria', { block: block.label })}
            className={`switch${block.on ? ' switch-on' : ''}`} disabled={!editable} onClick={() => onEdit({ kind: 'on', module: block.module, on: !block.on })}>
            <span className="switch-knob" />
          </button>
        </span>
      </header>
      <div className={`editor-face face-${block.key}`}>
      {block.key === 'amp' && <AmpDecor />}
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
      {block.key === 'amp' && guide && <p className="amp-script">{t('editor.basedOn', { gear: guide.label[lang] })}</p>}
      {(info?.basedOn || info?.about) && (() => {
        // The AMP's faceplate already signs "Based on …"; the line below then only describes it.
        const basedOn = block.key === 'amp' && guide ? undefined : info.basedOn;
        return <p className="editor-info">{basedOn ? t('editor.basedOn', { gear: basedOn }) : ''}{basedOn && info.about ? ' · ' : ''}{lang === 'pt' && guide ? guide.aboutPt : info.about}</p>;
      })()}
      </div>
    </section>
  );
}

/** Faceplate details of the AMP panel: screws, top vent, a lit power tube and the speaker grille. */
function AmpDecor() {
  return (
    <>
      <span className="amp-screw amp-screw-tl" aria-hidden="true" />
      <span className="amp-screw amp-screw-tr" aria-hidden="true" />
      <span className="amp-screw amp-screw-bl" aria-hidden="true" />
      <span className="amp-screw amp-screw-br" aria-hidden="true" />
      <span className="amp-vent" aria-hidden="true" />
      <svg className="amp-tube" viewBox="0 0 40 72" aria-hidden="true">
        <rect x="6" y="2" width="28" height="56" rx="13" className="amp-tube-glass" />
        <rect x="14" y="14" width="12" height="30" rx="3" className="amp-tube-plate" />
        <path d="M20 46 V22 M16 22 h8" className="amp-tube-filament" />
        <rect x="9" y="56" width="22" height="12" rx="2" className="amp-tube-base" />
      </svg>
      <span className="amp-grille" aria-hidden="true" />
    </>
  );
}
