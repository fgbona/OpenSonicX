import { presetLabel, type Edit, type Preset } from '@pocket-master/core';
import { BlockCard } from './BlockCard';
import { ChainStrip } from './ChainStrip';

interface Props {
  preset: Preset;
  presetIndex: number | null;
  editable: boolean;
  modified: boolean;
  onEdit: (edit: Edit) => void;
}

export function ChainView({ preset, presetIndex, editable, modified, onEdit }: Props) {
  return (
    <section aria-label="Current preset">
      <div className="preset-head">
        <div>
          <p className="eyebrow">Edit buffer{modified ? ' · modified' : ''}</p>
          <h1 className="preset-name">{presetIndex === null ? 'Preset' : presetLabel(presetIndex)}</h1>
        </div>
        <dl className="preset-meta">
          <div><dt>Volume</dt><dd>{preset.volume ?? '—'}</dd></div>
          <div><dt>Amp mode</dt><dd>{preset.ampMode === 'clone' ? 'Captured profile' : 'Amp model'}</dd></div>
          <div><dt>Access</dt><dd>{editable ? 'Live edit' : 'Read only'}</dd></div>
        </dl>
      </div>
      <ChainStrip chain={preset.chain} editable={editable} onEdit={onEdit} />
      <div className="blocks">
        {preset.chain.map((b) => <BlockCard key={b.key} preset={preset} block={b} editable={editable} onEdit={onEdit} />)}
      </div>
    </section>
  );
}
