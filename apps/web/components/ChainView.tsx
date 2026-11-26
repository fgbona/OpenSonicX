'use client';

import { memo, useState } from 'react';
import { blockModelLabel, presetLabel, type Edit, type Preset } from '@pocket-master/core';
import { pmParamValue, pmRigBlocks, pmRigMoves } from '@/lib/rigBlocks';
import { useRigLook } from '@/lib/rigLook';
import { ChainTiles } from './ChainTiles';
import { ModuleEditor } from './ModuleEditor';
import { PresetFields } from './PresetFields';
import { RigView } from './rig/RigView';
import { useI18n } from './I18n';

interface Props {
  preset: Preset;
  presetIndex: number | null;
  presetName: string | null;
  editable: boolean;
  modified: boolean;
  onEdit: (edit: Edit) => void;
  irNames: readonly (string | null)[] | null;
  profileNames: readonly (string | null)[] | null;
}

const AMP_MODULE = 3;

/** Memoised: incoming SysEx packets re-render the page, but the chain only when the preset changes. */
export const ChainView = memo(function ChainView({ preset, presetIndex, presetName, editable, modified, onEdit, irNames, profileNames }: Props) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(AMP_MODULE);
  const rig = useRigLook();
  const block = preset.chain.find((b) => b.module === selected) ?? preset.chain[0]!;
  const moves = pmRigMoves(preset.chain.map((b) => b.module));
  const editor = <ModuleEditor preset={preset} block={block} editable={editable} onEdit={onEdit} irNames={irNames} profileNames={profileNames} />;
  return (
    <section className="preset" aria-label={t('preset.aria')}>
      <div className="preset-head">
        <div>
          <p className="eyebrow">
            {t('preset.editBuffer')}
            {modified ? ` · ${t('preset.modified')}` : ''} · {preset.ampMode === 'clone' ? t('preset.ampCaptured') : t('preset.ampModel')}
          </p>
          <h1 className="preset-name">
            {presetIndex === null ? t('preset.fallbackName') : presetLabel(presetIndex)}
            {presetName && <span className="preset-title"> {presetName}</span>}
          </h1>
        </div>
        <PresetFields preset={preset} editable={editable} onEdit={onEdit} />
      </div>
      {rig ? (
        <RigView
          blocks={pmRigBlocks(preset, (b) => blockModelLabel(b, preset.ampMode, irNames, profileNames), [t('block.off'), t('block.on')])}
          selected={block.module}
          label={presetIndex === null ? t('preset.fallbackName') : presetLabel(presetIndex)}
          name={presetName ?? ''}
          tempo={preset.bpm}
          volume={preset.volume}
          disabled={!editable}
          onSelect={setSelected}
          onOn={(module, on) => onEdit({ kind: 'on', module, on })}
          onParam={(module, alg, v) => {
            const value = pmParamValue(preset, module, alg, v);
            if (value !== null) onEdit({ kind: 'param', module, alg, value });
          }}
          panel={editor}
          edit={{
            onMove: (from, to) => {
              const order = moves.move(from, to);
              if (order) onEdit({ kind: 'chain', order });
            },
            unit: moves.unit,
            hint: t('rig.pmUnit'),
          }}
        />
      ) : (
        <>
          <ChainTiles chain={preset.chain} editable={editable} selected={block.module} onSelect={setSelected} onEdit={onEdit} irNames={irNames} profileNames={profileNames} ampMode={preset.ampMode} />
          {editor}
        </>
      )}
    </section>
  );
});
