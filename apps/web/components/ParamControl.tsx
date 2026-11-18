'use client';

import { encodeValue, type Param, type ParamSpec } from '@pocket-master/core';

interface Props {
  /** Module of the block, so ids stay unique across blocks that share parameter names. */
  module: number;
  param: Param;
  spec: ParamSpec | undefined;
  editable: boolean;
  onChange: (alg: number, value: number) => void;
}

function Readout({ param }: { param: Param }) {
  const range = param.min !== undefined && param.max !== undefined && param.max > param.min;
  const fill = range ? ((param.value - param.min!) / (param.max! - param.min!)) * 100 : 0;
  return range ? (
    <span className="param-track" aria-hidden>
      <span className="param-fill" style={{ width: `${Math.min(100, Math.max(0, fill))}%` }} />
    </span>
  ) : null;
}

export function ParamControl({ module, param, spec, editable, onChange }: Props) {
  const id = `p-${module}-${param.alg}`;
  const send = (input: number | boolean | string) => {
    if (spec) onChange(param.alg, encodeValue(spec, input));
  };
  const live = editable && spec !== undefined;

  if (live && param.kind === 'switch') {
    const on = param.value >= 0.5;
    return (
      <li className="param param-inline">
        <span className="param-name" id={id}>{param.name}</span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={id} className={`switch${on ? ' switch-on' : ''}`} onClick={() => send(!on)}>
          <span className="switch-knob" />
        </button>
      </li>
    );
  }
  if (live && param.kind === 'select') {
    return (
      <li className="param param-inline">
        <label className="param-name" htmlFor={id}>{param.name}</label>
        <select id={id} className="param-select" value={Math.round(param.value)} onChange={(e) => send(Number(e.target.value))}>
          {spec.options?.map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      </li>
    );
  }
  if (live && param.kind === 'number') {
    return (
      <li className="param">
        <label className="param-name" htmlFor={id}>{param.name}</label>
        <span className="param-value">{param.display}</span>
        <input
          id={id}
          className="param-slider"
          type="range"
          min={param.min}
          max={param.max}
          step={spec.step ?? 1}
          value={param.value}
          onChange={(e) => send(Number(e.target.value))}
          style={{ '--fill': `${((param.value - param.min!) / (param.max! - param.min!)) * 100}%` } as React.CSSProperties}
        />
      </li>
    );
  }
  return (
    <li className="param">
      <span className="param-name">{param.name}</span>
      <span className="param-value">{param.display}</span>
      <Readout param={param} />
    </li>
  );
}
