import { presetLabel, type Block, type Param, type Preset } from '@pocket-master/core';

function ParamRow({ param }: { param: Param }) {
  const range = param.min !== undefined && param.max !== undefined && param.max > param.min;
  const fill = range ? ((param.value - param.min!) / (param.max! - param.min!)) * 100 : 0;
  return (
    <li className="param">
      <span className="param-name">{param.name}</span>
      <span className="param-value">{param.display}</span>
      {range && (
        <span className="param-track" aria-hidden>
          <span className="param-fill" style={{ width: `${Math.min(100, Math.max(0, fill))}%` }} />
        </span>
      )}
    </li>
  );
}

function BlockCard({ block }: { block: Block }) {
  return (
    <article className={`block block-${block.key}${block.on ? '' : ' block-off'}`}>
      <header className="block-head">
        <span className="block-label">{block.label}</span>
        <span className={`pill ${block.on ? 'pill-on' : 'pill-off'}`}>{block.on ? 'On' : 'Off'}</span>
      </header>
      <h3 className="block-model">{block.model}</h3>
      {block.params.length > 0 ? (
        <ul className="params">{block.params.map((p) => <ParamRow key={p.name} param={p} />)}</ul>
      ) : (
        <p className="muted small">No parameters in the catalog for this model.</p>
      )}
    </article>
  );
}

export function ChainView({ preset, presetIndex }: { preset: Preset; presetIndex: number | null }) {
  return (
    <section aria-label="Current preset">
      <div className="preset-head">
        <div>
          <p className="eyebrow">Edit buffer</p>
          <h1 className="preset-name">{presetIndex === null ? 'Preset' : presetLabel(presetIndex)}</h1>
        </div>
        <dl className="preset-meta">
          <div><dt>Volume</dt><dd>{preset.volume ?? '—'}</dd></div>
          <div><dt>Amp mode</dt><dd>{preset.ampMode === 'clone' ? 'Captured profile' : 'Amp model'}</dd></div>
          <div><dt>Access</dt><dd>Read only</dd></div>
        </dl>
      </div>
      <ol className="chain" aria-label="Signal chain">
        {preset.chain.map((b) => (
          <li key={b.key} className={`chain-node block-${b.key}${b.on ? '' : ' block-off'}`} title={`${b.label}: ${b.model}`}>
            <span className="chain-label">{b.label}</span>
            <span className="chain-model">{b.model}</span>
          </li>
        ))}
      </ol>
      <div className="blocks">{preset.chain.map((b) => <BlockCard key={b.key} block={b} />)}</div>
    </section>
  );
}
