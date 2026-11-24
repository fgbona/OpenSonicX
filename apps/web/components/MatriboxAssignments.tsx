'use client';

import { useState } from 'react';
import { MB_FOOTSWITCHES, mbAssignments, type MbExpressionAssignment, type MbExpressionEntry, type MbPreset, type MbResolvedBlock } from '@pocket-master/core';
import { useI18n } from './I18n';

const SWITCHES = 'ABCD';
const round = (n: number) => Number(n.toFixed(2));

interface Props {
  preset: MbPreset;
  chain: readonly MbResolvedBlock[];
  disabled: boolean;
  onFootswitch: (footswitch: number, slot: number, on: boolean) => void;
  onExpression: (assignment: MbExpressionAssignment) => void;
}

/** Which blocks footswitches A-D toggle (stomp mode), and the nine expression-pedal entries. */
export function MatriboxAssignments({ preset, chain, disabled, onFootswitch, onExpression }: Props) {
  const { t } = useI18n();
  const a = mbAssignments(preset);
  return (
    <section className="panel mb-assignments" aria-label={t('mb.assignments')}>
      <div className="panel-head">
        <h2>{t('mb.footswitches')}</h2>
      </div>
      <div className="mb-table-wrap">
        <table className="mb-table">
          <thead>
            <tr>
              <th scope="col">{t('mb.footswitch')}</th>
              {chain.map((b) => (
                <th key={b.slot} scope="col">
                  {b.position}. {b.module}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: MB_FOOTSWITCHES }, (_, row) => (
              <tr key={row}>
                <th scope="row">{SWITCHES[row]}</th>
                {chain.map((b) => (
                  <td key={b.slot}>
                    <input
                      type="checkbox"
                      checked={a.footswitches[row]?.includes(b.slot) ?? false}
                      disabled={disabled}
                      aria-label={t('mb.footswitchToggles', { fs: SWITCHES[row] ?? '', block: `${b.position}. ${b.module}` })}
                      onChange={(e) => onFootswitch(row, b.slot, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-head">
        <h2>{t('mb.expression')}</h2>
      </div>
      <p className="muted small mb-pad">{t('mb.expressionHint')}</p>
      <ul className="mb-exp">
        {a.expression.map((e) => (
          <ExpressionRow key={`${e.entry}:${e.slot}:${e.paramId}:${e.min}:${e.max}`} entry={e} chain={chain} disabled={disabled} onApply={onExpression} />
        ))}
      </ul>
    </section>
  );
}

/** One entry: block, parameter, heel (min) and toe (max), sent together with Apply. */
function ExpressionRow({ entry, chain, disabled, onApply }: { entry: MbExpressionEntry; chain: readonly MbResolvedBlock[]; disabled: boolean; onApply: (a: MbExpressionAssignment) => void }) {
  const { t } = useI18n();
  const [slot, setSlot] = useState<number | null>(entry.slot);
  const [paramId, setParamId] = useState(entry.paramId);
  const [min, setMin] = useState(round(entry.min));
  const [max, setMax] = useState(round(entry.max));
  const block = chain.find((b) => b.slot === slot);
  const params = block?.model?.params ?? [];
  const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  const ready = slot !== null && params.some((p) => p.id === paramId) && inRange(min) && inRange(max);
  const n = entry.entry + 1;
  return (
    <li className="mb-exp-row">
      <span className="chain-label">{n}</span>
      <select
        aria-label={t('mb.expBlock', { n })}
        value={slot ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value === '' ? null : Number(e.target.value);
          setSlot(next);
          setParamId(chain.find((b) => b.slot === next)?.model?.params[0]?.id ?? 0);
        }}
      >
        <option value="">{t('mb.expNone')}</option>
        {chain.map((b) => (
          <option key={b.slot} value={b.slot}>
            {b.position}. {b.module}
            {b.model ? ` ${b.model.name}` : ''}
          </option>
        ))}
      </select>
      <select aria-label={t('mb.expParam', { n })} value={paramId} disabled={disabled || params.length === 0} onChange={(e) => setParamId(Number(e.target.value))}>
        {params.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="mb-switch">
        <span>{t('mb.expMin')}</span>
        <input className="mb-number" type="number" min={0} max={100} value={min} disabled={disabled} aria-label={t('mb.expMinAria', { n })} onChange={(e) => setMin(Number(e.target.value))} />
      </label>
      <label className="mb-switch">
        <span>{t('mb.expMax')}</span>
        <input className="mb-number" type="number" min={0} max={100} value={max} disabled={disabled} aria-label={t('mb.expMaxAria', { n })} onChange={(e) => setMax(Number(e.target.value))} />
      </label>
      <button type="button" className="btn btn-small" disabled={disabled || !ready} onClick={() => slot !== null && onApply({ entry: entry.entry, slot, paramId, min, max })}>
        {t('mb.expApply')}
      </button>
    </li>
  );
}
