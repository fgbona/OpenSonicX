'use client';

import { useMemo, useRef, useState } from 'react';
import { MB_SLOTS, type MbCatalog, type MbResolvedBlock } from '@pocket-master/core';
import { mbFxidHex, mbLookKey, mbModelGroups, parseMbModelValue } from '@/lib/matriboxLook';
import { PickerList } from './ModelPicker';
import { PedalTile, TileMove, TileStrip } from './TileStrip';
import { useI18n } from './I18n';
import { useTileDrag } from './useTileDrag';

interface Props {
  chain: readonly MbResolvedBlock[];
  catalog: MbCatalog | null;
  /** Storage slot of the block the panel below edits. */
  selected: number | null;
  disabled: boolean;
  /** The user IR or capture an IR or CLONE block plays. */
  userSlot: (block: MbResolvedBlock) => string | undefined;
  onSelect: (slot: number) => void;
  onOn: (slot: number, on: boolean) => void;
  onMove: (from: number, to: number) => void;
  onAdd: (moduleIndex: number, fxid: number) => void;
}

/** What a tile says under the module: the model, the user IR or capture it plays, or the raw model id. */
export const mbTileModel = (block: MbResolvedBlock, userSlot: string | undefined) => userSlot ?? block.model?.name ?? mbFxidHex(block.fxid).slice(2);

/**
 * The Matribox's signal chain as the pedals of the Pocket Master's strip: a click selects the
 * block, the LED switches it, a drag (or the arrows) moves it, and the last tile adds a block (with the
 * catalog, while the unit has a free slot).
 */
export function MatriboxChain({ chain, catalog, selected, disabled, userSlot, onSelect, onOn, onMove, onAdd }: Props) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => (catalog ? mbModelGroups(catalog) : []), [catalog]);
  const canAdd = catalog !== null && chain.length < MB_SLOTS;
  // One move write per drop; a drop on the tile's own place writes nothing.
  const drag = useTileDrag(!disabled, (from, to) => {
    if (from !== to) onMove(from, to);
  });
  const closeAdd = (refocus: boolean) => {
    setAdding(false);
    if (refocus) addRef.current?.focus();
  };
  return (
    <TileStrip
      deps={[chain.length, canAdd]}
      editable={!disabled}
      overlay={
        adding && canAdd ? (
          <div className="picker mb-add-menu" ref={menuRef}>
            <PickerList
              groups={groups}
              value=""
              ariaLabel={t('mb.addBlock')}
              isInside={(target) => (addRef.current?.contains(target) || menuRef.current?.contains(target)) ?? false}
              onClose={closeAdd}
              onChoose={(value) => {
                closeAdd(true);
                const model = parseMbModelValue(value);
                if (model) onAdd(model.moduleIndex, model.fxid);
              }}
            />
          </div>
        ) : null
      }
    >
      {chain.map((block, at) => {
        const name = `${block.position}. ${block.module}`;
        const model = mbTileModel(block, userSlot(block));
        const { className, ...dragProps } = drag(at, at);
        return (
          <li key={block.slot} className={`tile-unit mb-unit${className}`} {...dragProps}>
            <PedalTile
              tint={`mb-${mbLookKey(block)}`}
              icon={mbLookKey(block)}
              label={block.module}
              model={model}
              on={block.on}
              selected={selected === block.slot}
              editable={!disabled}
              selectLabel={t('tile.select', { block: name, model })}
              ledLabel={t(block.on ? 'block.onAria' : 'block.offAria', { block: name })}
              onSelect={() => onSelect(block.slot)}
              onToggle={() => onOn(block.slot, !block.on)}
            />
            {!disabled && (
              <TileMove
                earlierLabel={t('mb.moveUp', { n: block.position })}
                laterLabel={t('mb.moveDown', { n: block.position })}
                first={at === 0}
                last={at === chain.length - 1}
                onEarlier={() => onMove(at, at - 1)}
                onLater={() => onMove(at, at + 1)}
              />
            )}
          </li>
        );
      })}
      {chain.length === 0 && <li className="tile-unit mb-unit mb-chain-empty muted small">{t('mb.empty')}</li>}
      {canAdd && (
        <li className="tile-unit mb-unit mb-unit-add">
          <button
            ref={addRef}
            type="button"
            className="tile mb-tile-add"
            aria-haspopup="listbox"
            aria-expanded={adding}
            aria-label={t('mb.addBlock')}
            disabled={disabled}
            onClick={() => setAdding(!adding)}
          >
            <span className="mb-tile-plus" aria-hidden="true">
              +
            </span>
            <span className="tile-label">{t('mb.add')}</span>
          </button>
        </li>
      )}
    </TileStrip>
  );
}
