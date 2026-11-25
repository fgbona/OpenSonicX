'use client';

import { useState, useSyncExternalStore } from 'react';
import { type Block, blockModelLabel, chainUnits, type Edit, moveInChain } from '@pocket-master/core';
import { PedalTile, TileMove, TileStrip } from './TileStrip';
import { useI18n } from './I18n';

interface Props {
  chain: readonly Block[];
  editable: boolean;
  selected: number;
  onSelect: (module: number) => void;
  onEdit: (edit: Edit) => void;
  irNames: readonly (string | null)[] | null;
  profileNames: readonly (string | null)[] | null;
  ampMode: 'normal' | 'clone';
}

/**
 * The signal chain as pedals: drawing, label, model, an on/off LED. A
 * click selects the block for the editor; in live edit units drag (or move with the arrows), and
 * DRV-AMP-IR-EQ move together.
 */
/** Touch screens (no hover): a draggable tile would take the swipe and the strip could not scroll. */
const TOUCH = '(hover: none)';
const touchOnly = () => window.matchMedia(TOUCH).matches;
const onTouchChange = (notify: () => void) => {
  const query = window.matchMedia(TOUCH);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export function ChainTiles({ chain, editable, selected, onSelect, onEdit, irNames, profileNames, ampMode }: Props) {
  const { t } = useI18n();
  const touch = useSyncExternalStore(onTouchChange, touchOnly, () => false);
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
    <TileStrip deps={[chain.length]} editable={editable}>
      {units.map((unit, index) => {
        const lead = unit[0] as number;
        const name = unit.map((m) => byModule.get(m)?.label).join('-');
        return (
          <li
            key={lead}
            className={`tile-unit${unit.length > 1 ? ' tile-group' : ''}${dragging === lead ? ' tile-dragging' : ''}${over === index && dragging !== null ? ' tile-over' : ''}`}
            draggable={editable && !touch}
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
              const model = blockModelLabel(b, ampMode, irNames, profileNames);
              return (
                <PedalTile
                  key={m}
                  tint={`block-${b.key}`}
                  icon={b.key}
                  label={b.label}
                  model={model}
                  on={b.on}
                  selected={selected === m}
                  editable={editable}
                  selectLabel={t('tile.select', { block: b.label, model })}
                  ledLabel={t(b.on ? 'block.onAria' : 'block.offAria', { block: b.label })}
                  onSelect={() => onSelect(m)}
                  onToggle={() => onEdit({ kind: 'on', module: b.module, on: !b.on })}
                />
              );
            })}
            {editable && (
              <TileMove
                earlierLabel={t('chain.earlier', { name })}
                laterLabel={t('chain.later', { name })}
                first={index === 0}
                last={index === units.length - 1}
                onEarlier={() => move(lead, index - 1)}
                onLater={() => move(lead, index + 1)}
              />
            )}
          </li>
        );
      })}
    </TileStrip>
  );
}
