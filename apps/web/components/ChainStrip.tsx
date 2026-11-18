'use client';

import { useState } from 'react';
import { chainUnits, moveInChain, type Block, type Edit } from '@pocket-master/core';
import { useI18n } from './I18n';

interface Props {
  chain: readonly Block[];
  editable: boolean;
  onEdit: (edit: Edit) => void;
}

/** Signal chain. In live edit, units can be dragged or moved with the arrow buttons; DRV-AMP-IR-EQ move as one. */
export function ChainStrip({ chain, editable, onEdit }: Props) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const order = chain.map((b) => b.module);
  const byModule = new Map(chain.map((b) => [b.module, b]));
  const units = chainUnits(order);
  const move = (module: number, to: number) => {
    const next = moveInChain(order, module, to);
    if (next.some((m, i) => m !== order[i])) onEdit({ kind: 'chain', order: next });
  };

  return (
    <ol className={`chain${editable ? ' chain-editable' : ''}`} aria-label={t('chain.aria')}>
      {units.map((unit, index) => {
        const lead = unit[0] as number;
        const name = unit.map((m) => byModule.get(m)?.label).join('-');
        return (
          <li
            key={lead}
            className={`chain-unit${unit.length > 1 ? ' chain-group' : ''}${dragging === lead ? ' chain-dragging' : ''}${over === index && dragging !== null ? ' chain-over' : ''}`}
            draggable={editable}
            onDragStart={(e) => {
              setDragging(lead);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(lead));
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              setOver(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) move(dragging, index);
              setDragging(null);
              setOver(null);
            }}
          >
            {unit.map((m) => {
              const b = byModule.get(m) as Block;
              return (
                <span key={m} className={`chain-node block-${b.key}${b.on ? '' : ' block-off'}`} title={`${b.label}: ${b.model}`}>
                  <span className="chain-label">{b.label}</span>
                  <span className="chain-model">{b.model}</span>
                </span>
              );
            })}
            {editable && (
              <span className="chain-move">
                <button type="button" aria-label={t('chain.earlier', { name })} disabled={index === 0} onClick={() => move(lead, index - 1)}>‹</button>
                <button type="button" aria-label={t('chain.later', { name })} disabled={index === units.length - 1} onClick={() => move(lead, index + 1)}>›</button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
