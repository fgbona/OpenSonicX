'use client';

import type { MbCatalog, MbResolvedBlock } from '@pocket-master/core';
import { hasTube } from '@/lib/ampSkins';
import { gearOf } from '@/lib/matribox';
import { mbAmpSkin, mbFxidHex, mbLookKey, mbModelValue, parseMbModelValue } from '@/lib/matriboxLook';
import { mbMenuModels } from '@/lib/matriboxMenus';
import { AmpDecor } from './AmpDecor';
import { MatriboxParam } from './MatriboxParam';
import { ModelPicker } from './ModelPicker';
import { ModuleIcon } from './ModuleIcon';
import { useI18n } from './I18n';
import { useTranslatedText } from '@/lib/useTranslatedText';

interface Props {
  block: MbResolvedBlock;
  /** The slot's 15 stored values, shown raw when the catalog does not name the model. */
  values: readonly number[];
  catalog: MbCatalog | null;
  /** The user IR or capture an IR or CLONE model plays; the model menu names it so. */
  userSlot: (block: Pick<MbResolvedBlock, 'module' | 'fxid'>) => string | undefined;
  disabled: boolean;
  onParam: (slot: number, id: number, value: number) => void;
  onOn: (slot: number, on: boolean) => void;
  /** Change model names the block's storage slot, not its chain position. */
  onModel: (slot: number, moduleIndex: number, fxid: number) => void;
  onRemove: (position: number) => void;
}

const round = (n: number) => String(Number(n.toFixed(2)));

/** The amp's gain as 0..1, for how hot the tube glows; middle when the model has no gain knob. */
function driveOf(block: MbResolvedBlock): number {
  const gain = block.params.find((p) => /gain/i.test(p.name));
  if (!gain || gain.max === gain.min || !Number.isFinite(gain.value)) return 0.5;
  return (gain.value - gain.min) / (gain.max - gain.min);
}

/**
 * The selected block of the loaded Matribox preset, in the Pocket Master's block panel: module and
 * model menu, on/off, every parameter as a knob, switch or small selector, and an AMP dressed like
 * the gear its model is based on.
 */
export function MatriboxBlockPanel({ block, values, catalog, userSlot, disabled, onParam, onOn, onModel, onRemove }: Props) {
  const { t, lang } = useI18n();
  // The catalog's description is English; in Portuguese it is translated on this device (lib/translate.ts).
  const description = useTranslatedText(block.model?.description ?? '', lang === 'pt');
  const key = mbLookKey(block);
  const name = `${block.position}. ${block.module}`;
  const unknown = t('mb.unknownModel', { fxid: mbFxidHex(block.fxid) });
  const value = mbModelValue(block.moduleIndex, block.fxid);
  // Only this block's module: a model change keeps the block type. A model the catalog does not name still shows as the chosen one.
  const listed = catalog ? mbMenuModels(catalog, block.moduleIndex, [], { other: t('block.otherModels'), unknown: (fxid) => fxid, userName: (fxid) => userSlot({ module: block.module, fxid }) }) : [];
  const groups = block.model ? listed : [{ name: null, options: [{ value, name: unknown, disabled: true }] }, ...listed];
  const gear = block.model ? gearOf(block.model) : '';
  // The faceplate needs the model: without the catalog an AMP shows its raw values like any block.
  const amp = key === 'amp' && block.model !== null;
  const skin = amp && block.model ? mbAmpSkin(block.model.origin) : null;

  return (
    <section className={`editor mb-${key}${block.on ? '' : ' editor-off'}`} aria-label={t('editor.aria', { block: name })}>
      <header className="editor-head">
        <ModuleIcon blockKey={key} size={36} />
        <span className="editor-label">{block.module}</span>
        {catalog ? (
          <ModelPicker
            ariaLabel={t('block.modelAria', { block: name })}
            value={value}
            groups={groups}
            onChange={(v) => {
              const model = parseMbModelValue(v);
              if (model && !disabled) onModel(block.slot, model.moduleIndex, model.fxid);
            }}
          />
        ) : (
          <span className="editor-model editor-model-static">{unknown}</span>
        )}
        <span className="editor-end">
          <button type="button" className="btn btn-small" disabled={disabled} aria-label={t('mb.removeAria', { block: name })} onClick={() => onRemove(block.position - 1)}>
            {t('mb.remove')}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={block.on}
            aria-label={t(block.on ? 'block.onAria' : 'block.offAria', { block: name })}
            className={`switch${block.on ? ' switch-on' : ''}`}
            disabled={disabled}
            onClick={() => onOn(block.slot, !block.on)}
          >
            <span className="switch-knob" />
          </button>
        </span>
      </header>
      <div className={`editor-face ${amp ? 'face-amp' : `face-mb-${key}`}`} data-skin={skin ?? undefined}>
        {amp && <AmpDecor on={block.on} drive={driveOf(block)} tubeKey={block.fxid} tube={hasTube(skin)} />}
        {block.model ? (
          block.params.length === 0 ? (
            <p className="muted small">{t('block.noParams')}</p>
          ) : (
            <div className="editor-params">
              {block.params.map((p) => (
                <MatriboxParam key={p.id} param={p} spec={block.model?.params.find((m) => m.id === p.id)} disabled={disabled} onChange={(v) => onParam(block.slot, p.id, v)} />
              ))}
            </div>
          )
        ) : (
          <div className="mb-raw">
            <p className="muted small">{t('mb.rawValues', { slot: block.slot + 1 })}</p>
            <ol className="mb-raw-values" aria-label={t('mb.rawAria', { block: name })}>
              {values.map((v, i) => (
                <li key={i}>
                  <span className="muted">{i}</span> {round(v)}
                </li>
              ))}
            </ol>
          </div>
        )}
        {amp && gear && <p className="amp-script">{t('editor.basedOn', { gear })}</p>}
        {block.model && ((gear && !amp) || block.model.description) && (
          <p className="editor-info">
            {gear && !amp ? t('editor.basedOn', { gear }) : ''}
            {gear && !amp && block.model.description ? ' · ' : ''}
            {block.model.description && <span lang={description.state === 'translated' ? 'pt-BR' : 'en'}>{description.text}</span>}
            {description.state === 'translated' && <span className="editor-info-note">{t('mb.translated')}</span>}
            {description.state === 'english' && <span className="editor-info-note">{t('mb.inEnglish')}</span>}
            {description.state === 'download' && (
              <button type="button" className="btn btn-small editor-info-note" onClick={description.start}>
                {t('mb.translateButton')}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
