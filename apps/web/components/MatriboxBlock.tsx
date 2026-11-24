'use client';

import type { MbCatalog, MbResolvedBlock } from '@pocket-master/core';
import { gearOf } from '@/lib/matribox';
import { useI18n } from './I18n';

const fxidHex = (fxid: number) => `0x${fxid.toString(16).padStart(8, '0')}`;
const round = (n: number) => String(Number(n.toFixed(2)));

/** A model picker grouped by module; its value is "moduleIndex:fxid". */
export function MatriboxModelSelect(props: { catalog: MbCatalog; label: string; value: string; disabled: boolean; onChange: (moduleIndex: number, fxid: number) => void }) {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => {
        const [moduleIndex, fxid] = e.target.value.split(':').map(Number);
        if (moduleIndex !== undefined && fxid !== undefined && e.target.value) props.onChange(moduleIndex, fxid);
      }}
    >
      <option value="">{props.label}</option>
      {props.catalog.modules.map((m) => (
        <optgroup key={m.index} label={m.name}>
          {m.models.map((model) => (
            <option key={model.fxid} value={`${m.index}:${model.fxid}`}>
              {model.name}
              {gearOf(model) ? ` · ${gearOf(model)}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

interface Props {
  block: MbResolvedBlock;
  chainLength: number;
  catalog: MbCatalog | null;
  /** The user IR or capture this block plays, for IR and CLONE blocks. */
  userSlot: string | undefined;
  disabled: boolean;
  onParam: (slot: number, id: number, value: number) => void;
  onOn: (slot: number, on: boolean) => void;
  /** Change model names the block's storage slot, not its chain position. */
  onModel: (slot: number, moduleIndex: number, fxid: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (position: number) => void;
}

/** One block of the loaded preset: model, what it is based on, on/off, parameters and chain edits. */
export function MatriboxBlock({ block, chainLength, catalog, userSlot, disabled, onParam, onOn, onModel, onMove, onRemove }: Props) {
  const { t } = useI18n();
  const at = block.position - 1;
  const gear = block.model ? gearOf(block.model) : '';
  const title = block.model ? block.model.name : t('mb.unknownModel', { fxid: fxidHex(block.fxid) });
  return (
    <li className={`panel mb-block${block.on ? '' : ' block-off'}`} aria-label={`${block.position}. ${block.module} ${title}`}>
      <div className="panel-head">
        <div>
          <h3 className="mb-block-title">
            <span className="chain-label">
              {block.position}. {block.module}
            </span>{' '}
            {title}
            {userSlot ? ` "${userSlot}"` : ''}
          </h3>
          {gear && <p className="muted small">{t('mb.basedOn', { gear })}</p>}
          {!block.model && (
            <p className="muted small">
              fxid {fxidHex(block.fxid)} · slot {block.slot + 1}
            </p>
          )}
        </div>
        <label className="mb-switch">
          <input type="checkbox" checked={block.on} disabled={disabled} onChange={(e) => onOn(block.slot, e.target.checked)} />
          <span>{t(block.on ? 'mb.on' : 'mb.off')}</span>
        </label>
      </div>
      {block.params.length > 0 && (
        <div className="mb-params">
          {block.params.map((p) => {
            const step = block.model?.params.find((m) => m.id === p.id)?.step ?? 1;
            const set = (value: number) => {
              if (Number.isFinite(value) && value >= p.min && value <= p.max) onParam(block.slot, p.id, value);
            };
            return (
              <label key={p.id} className="field mb-param">
                <span>
                  {p.name} <span className="muted">{round(p.value)}</span>
                </span>
                <input type="range" min={p.min} max={p.max} step={step} value={p.value} disabled={disabled} aria-label={`${block.module} ${p.name}`} onChange={(e) => set(Number(e.target.value))} />
              </label>
            );
          })}
        </div>
      )}
      <div className="mb-block-actions">
        {catalog && <MatriboxModelSelect catalog={catalog} label={t('mb.changeModel')} value="" disabled={disabled} onChange={(m, fxid) => onModel(block.slot, m, fxid)} />}
        <button type="button" className="btn btn-small" disabled={disabled || at === 0} onClick={() => onMove(at, at - 1)} aria-label={t('mb.moveUp', { n: block.position })}>
          ↑
        </button>
        <button type="button" className="btn btn-small" disabled={disabled || at >= chainLength - 1} onClick={() => onMove(at, at + 1)} aria-label={t('mb.moveDown', { n: block.position })}>
          ↓
        </button>
        <button type="button" className="btn btn-small btn-danger" disabled={disabled} onClick={() => onRemove(at)}>
          {t('mb.remove')}
        </button>
      </div>
    </li>
  );
}
