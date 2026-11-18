import { memo } from 'react';
import { presetLabel, type Edit, type Preset } from '@pocket-master/core';
import { BlockCard } from './BlockCard';
import { ChainStrip } from './ChainStrip';
import { useI18n } from './I18n';

interface Props {
  preset: Preset;
  presetIndex: number | null;
  editable: boolean;
  modified: boolean;
  onEdit: (edit: Edit) => void;
}

/** Memoised: incoming SysEx packets re-render the page, but the chain only when the preset changes. */
export const ChainView = memo(function ChainView({ preset, presetIndex, editable, modified, onEdit }: Props) {
  const { t } = useI18n();
  return (
    <section aria-label="Current preset">
      <div className="preset-head">
        <div>
          <p className="eyebrow">{t('preset.editBuffer')}{modified ? ` · ${t('preset.modified')}` : ''}</p>
          <h1 className="preset-name">{presetIndex === null ? t('preset.fallbackName') : presetLabel(presetIndex)}</h1>
        </div>
        <dl className="preset-meta">
          <div><dt>{t('preset.volume')}</dt><dd>{preset.volume ?? '—'}</dd></div>
          <div><dt>{t('preset.ampMode')}</dt><dd>{preset.ampMode === 'clone' ? t('preset.ampCaptured') : t('preset.ampModel')}</dd></div>
          <div><dt>{t('preset.access')}</dt><dd>{editable ? t('live.label') : t('preset.readOnly')}</dd></div>
        </dl>
      </div>
      <ChainStrip chain={preset.chain} editable={editable} onEdit={onEdit} />
      <div className="blocks">
        {preset.chain.map((b) => <BlockCard key={b.key} preset={preset} block={b} editable={editable} onEdit={onEdit} />)}
      </div>
    </section>
  );
});
