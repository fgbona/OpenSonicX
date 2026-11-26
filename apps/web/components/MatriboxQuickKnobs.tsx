'use client';

import { useState } from 'react';
import { MB_QK_BPM, MB_QK_VOLUME, type MbQuickKnob, type MbResolvedBlock } from '@pocket-master/core';
import { Fold } from './Fold';
import { useI18n } from './I18n';

interface Props {
  quickKnobs: readonly MbQuickKnob[];
  chain: readonly MbResolvedBlock[];
  disabled: boolean;
  onAssign: (knob: number, target: number | null, paramId: number) => void;
}

/** The three quick knobs: each a block's parameter, the tempo, the patch volume or nothing. */
export function MatriboxQuickKnobs({ quickKnobs, chain, disabled, onAssign }: Props) {
  const { t } = useI18n();
  return (
    <Fold title={t('mb.quickKnobs')} open={false}>
      <div className="mb-body">
        <p className="muted small">{t('mb.quickKnobsHint')}</p>
        <ul className="mb-exp">
          {quickKnobs.map((q) => (
            <KnobRow key={`${q.knob}:${q.target}:${q.paramId}`} knob={q} chain={chain} disabled={disabled} onApply={onAssign} />
          ))}
        </ul>
      </div>
    </Fold>
  );
}

/** One knob: its target and, for a block, the parameter, sent together with Apply. */
function KnobRow({ knob, chain, disabled, onApply }: { knob: MbQuickKnob; chain: readonly MbResolvedBlock[]; disabled: boolean; onApply: Props['onAssign'] }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<number | null>(knob.target);
  const [paramId, setParamId] = useState(knob.paramId);
  const block = chain.find((b) => b.slot === target);
  const params = block?.model?.params ?? [];
  const isBlock = target !== null && target !== MB_QK_BPM && target !== MB_QK_VOLUME;
  const ready = !isBlock || params.some((p) => p.id === paramId);
  const n = knob.knob + 1;
  return (
    <li className="mb-exp-row">
      <span className="sidebar-badge">{n}</span>
      <select
        className="param-select"
        aria-label={t('mb.qkTarget', { n })}
        value={target ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value === '' ? null : Number(e.target.value);
          setTarget(next);
          setParamId(chain.find((b) => b.slot === next)?.model?.params[0]?.id ?? 0);
        }}
      >
        <option value="">{t('mb.qkNone')}</option>
        {chain.map((b) => (
          <option key={b.slot} value={b.slot}>
            {b.position}. {b.module}
            {b.model ? ` ${b.model.name}` : ''}
          </option>
        ))}
        <option value={MB_QK_BPM}>{t('mb.qkBpm')}</option>
        <option value={MB_QK_VOLUME}>{t('mb.qkVolume')}</option>
      </select>
      {isBlock && (
        <select className="param-select" aria-label={t('mb.qkParam', { n })} value={paramId} disabled={disabled || params.length === 0} onChange={(e) => setParamId(Number(e.target.value))}>
          {params.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn btn-small" disabled={disabled || !ready} onClick={() => onApply(knob.knob, target, isBlock ? paramId : 0)}>
        {t('mb.expApply')}
      </button>
    </li>
  );
}
