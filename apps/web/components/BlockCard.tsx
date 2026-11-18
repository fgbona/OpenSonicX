'use client';

import { modelOf, modelsFor, type Block, type Edit, type Preset } from '@pocket-master/core';
import { ParamControl } from './ParamControl';

interface Props {
  preset: Preset;
  block: Block;
  editable: boolean;
  onEdit: (edit: Edit) => void;
}

const SINGLE_MODEL = new Set(['nr']);

export function BlockCard({ preset, block, editable, onEdit }: Props) {
  const model = modelOf(preset, block);
  const clone = block.key === 'amp' && preset.ampMode === 'clone';
  const choices = SINGLE_MODEL.has(block.key) ? [] : modelsFor(block.key);
  return (
    <article className={`block block-${block.key}${block.on ? '' : ' block-off'}`}>
      <header className="block-head">
        <span className="block-label">{block.label}</span>
        {editable ? (
          <button
            type="button"
            className={`pill pill-button ${block.on ? 'pill-on' : 'pill-off'}`}
            aria-pressed={block.on}
            aria-label={`${block.label} ${block.on ? 'on' : 'off'}`}
            onClick={() => onEdit({ kind: 'on', module: block.module, on: !block.on })}
          >
            {block.on ? 'On' : 'Off'}
          </button>
        ) : (
          <span className={`pill ${block.on ? 'pill-on' : 'pill-off'}`}>{block.on ? 'On' : 'Off'}</span>
        )}
      </header>
      {editable && choices.length > 0 ? (
        <select
          className="block-model block-model-select"
          aria-label={`${block.label} model`}
          value={clone ? '' : block.code}
          onChange={(e) => onEdit({ kind: 'model', module: block.module, code: Number(e.target.value) })}
        >
          {clone && <option value="" disabled>{block.model} (captured)</option>}
          {choices.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
      ) : (
        <h3 className="block-model">{block.model}</h3>
      )}
      {block.params.length > 0 ? (
        <ul className="params">
          {block.params.map((p) => (
            <ParamControl
              key={p.alg}
              param={p}
              spec={model?.params.find((s) => s.alg === p.alg)}
              editable={editable}
              onChange={(alg, value) => onEdit({ kind: 'param', module: block.module, alg, value })}
            />
          ))}
        </ul>
      ) : (
        <p className="muted small">No parameters in the catalog for this model.</p>
      )}
    </article>
  );
}
