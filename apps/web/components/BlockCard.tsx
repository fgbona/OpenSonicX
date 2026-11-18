'use client';

import { modelOf, modelsFor, type Block, type Edit, type Preset } from '@pocket-master/core';
import { ParamControl } from './ParamControl';
import { useI18n } from './I18n';
import { blockModelLabel, modelLabel } from '@/lib/modelLabel';
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

export function BlockCard({ preset, block, editable, onEdit, irNames, profileNames }: Props) {
  const { t } = useI18n();
  const model = modelOf(preset, block);
  const clone = block.key === 'amp' && preset.ampMode === 'clone';
  const choices = SINGLE_MODEL.has(block.key) ? [] : modelsFor(block.key);
  const profiles = block.key === 'amp' ? profileChoices(profileNames) : [];
  const shownModel = blockModelLabel(block, preset.ampMode, irNames, profileNames);
  const profileName = clone && shownModel !== block.model ? shownModel : undefined;
  return (
    <article className={`block block-${block.key}${block.on ? '' : ' block-off'}`}>
      <header className="block-head">
        <span className="block-label">{block.label}</span>
        {editable ? (
          <button
            type="button"
            className={`pill pill-button ${block.on ? 'pill-on' : 'pill-off'}`}
            aria-pressed={block.on}
            aria-label={t(block.on ? 'block.onAria' : 'block.offAria', { block: block.label })}
            onClick={() => onEdit({ kind: 'on', module: block.module, on: !block.on })}
          >
            {block.on ? t('block.on') : t('block.off')}
          </button>
        ) : (
          <span className={`pill ${block.on ? 'pill-on' : 'pill-off'}`}>{block.on ? t('block.on') : t('block.off')}</span>
        )}
      </header>
      {editable && block.key === 'amp' ? (
        <select
          className="block-model block-model-select"
          aria-label={t('block.modelAria', { block: block.label })}
          value={modelValue(block.code, clone)}
          onChange={(e) => {
            const choice = parseModelValue(e.target.value);
            if (choice) onEdit({ kind: 'model', module: block.module, code: choice.code, clone: choice.clone });
          }}
        >
          {clone && !profileName && <option value={modelValue(block.code, true)} disabled>{t('block.captured', { model: block.model })}</option>}
          <optgroup label={t('block.ampModels')}>
            {choices.map((m) => <option key={m.code} value={modelValue(m.code, false)}>{m.name}</option>)}
          </optgroup>
          {profiles.length > 0 && (
            <optgroup label={t('block.profiles')}>
              {profiles.map((p) => <option key={p.code} value={modelValue(p.code, true)}>{t('block.profileOption', { name: p.name, n: p.slot })}</option>)}
            </optgroup>
          )}
        </select>
      ) : editable && choices.length > 0 ? (
        <select
          className="block-model block-model-select"
          aria-label={t('block.modelAria', { block: block.label })}
          value={block.code}
          onChange={(e) => onEdit({ kind: 'model', module: block.module, code: Number(e.target.value) })}
        >
          {choices.map((m) => <option key={m.code} value={m.code}>{modelLabel(block.key, m.code, m.name, irNames)}</option>)}
        </select>
      ) : (
        <h3 className="block-model">{shownModel}</h3>
      )}
      {block.params.length > 0 ? (
        <ul className="params">
          {block.params.map((p) => (
            <ParamControl
              key={p.alg}
              module={block.module}
              param={p}
              spec={model?.params.find((s) => s.alg === p.alg)}
              editable={editable}
              onChange={(alg, value) => onEdit({ kind: 'param', module: block.module, alg, value })}
            />
          ))}
        </ul>
      ) : (
        <p className="muted small">{t('block.noParams')}</p>
      )}
    </article>
  );
}
