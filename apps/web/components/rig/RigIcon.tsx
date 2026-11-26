/**
 * The rig view's gear drawings: one base drawing per kind of gear (lib/rigIcon.ts), its paint, knob
 * count, LED and switch from the model. Generic shapes only, no maker's look. 64 x 64 viewBox; the
 * outline takes --rig-edge so a dark enclosure still reads on the dark screen.
 */
import type { ReactNode } from 'react';
import { inkOn, type RigIconSpec } from '@/lib/rigIcon';

const EDGE = { stroke: 'var(--rig-edge)', strokeWidth: 1.5 } as const;

/** `n` points spread evenly between x0 and x1. */
const spread = (n: number, x0: number, x1: number) => Array.from({ length: n }, (_, i) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1)));

function Knob({ x, y, r, ink }: { x: number; y: number; r: number; ink: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#1c1c1e" stroke={ink} strokeOpacity={0.35} strokeWidth={0.8} />
      <path d={`M${x} ${y}l${r * 0.45} ${-r * 0.8}`} stroke="#f5f5f7" strokeWidth={1.2} strokeLinecap="round" />
    </g>
  );
}

/** Stompbox faces: the mark printed in the middle, by kind. */
const GLYPHS: Record<string, string> = {
  drive: 'M22 38l4-6h5l2 6h5l4-6',
  comp: 'M22 40l8-8h12',
  mod: 'M21 36c2.5-5 5-5 7.5 0s5 5 7.5 0 4-4 6 0',
  delay: 'M22 36h0M28 36h0M33 36h0M37 36h0M40 36h0',
  reverb: 'M24 40a5 5 0 0 1 0-8M29 42a10 10 0 0 1 0-12M34 44a15 15 0 0 1 0-16',
  gate: 'M21 39h5v-6h10v6h6',
};

function Stomp({ spec, face }: { spec: RigIconSpec; face?: ReactNode }) {
  const ink = inkOn(spec.body);
  const rows = spec.knobs > 3 ? [spread(2, 24, 40), spread(spec.knobs - 2, 24, 40)] : [spread(spec.knobs, 22, 42)];
  return (
    <>
      <rect x="14" y="6" width="36" height="52" rx="6" fill={spec.body} {...EDGE} />
      {rows.map((xs, row) => xs.map((x) => <Knob key={`${row}-${x}`} x={x} y={13 + row * 8} r={rows.length > 1 ? 3 : 3.6} ink={ink} />))}
      <circle cx="32" cy={spec.knobs > 3 ? 28 : 23} r="1.8" fill={spec.led} />
      {face ?? (
        <path d={GLYPHS[spec.category] ?? GLYPHS.drive} fill="none" stroke={ink} strokeWidth={spec.category === 'delay' ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      )}
      {spec.footswitch === 'round' ? (
        <>
          <circle cx="32" cy="50" r="5" fill="#c7ccd1" stroke="#636366" strokeWidth={1} />
          <circle cx="32" cy="50" r="2.4" fill="#8e8e93" />
        </>
      ) : (
        <rect x="22" y="46" width="20" height="8" rx="2.5" fill="#2c2c2e" stroke={ink} strokeOpacity={0.4} />
      )}
    </>
  );
}

function Eq({ spec }: { spec: RigIconSpec }) {
  const ink = inkOn(spec.body);
  const xs = spread(Math.max(3, spec.knobs), 20, 44);
  return (
    <Stomp
      spec={{ ...spec, knobs: 0 }}
      face={xs.map((x, i) => {
        const y = 22 + ((i * 7 + spec.knobs * 3) % 14);
        return (
          <g key={x}>
            <path d={`M${x} 14v26`} stroke={ink} strokeOpacity={0.5} strokeWidth={1.2} />
            <rect x={x - 2.2} y={y} width="4.4" height="3.6" rx="1" fill="#1c1c1e" stroke={ink} strokeWidth={0.6} />
          </g>
        );
      })}
    />
  );
}

function Treadle({ spec }: { spec: RigIconSpec }) {
  return (
    <>
      <path d="M10 46h44l2 8H8z" fill="#2c2c2e" {...EDGE} />
      <path d="M12 44 50 22l5 7-38 21z" fill={spec.body} {...EDGE} />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${20 + i * 6} ${40 - i * 3.5}l4 6`} stroke={inkOn(spec.body)} strokeOpacity={0.35} strokeWidth={1.4} strokeLinecap="round" />
      ))}
      <circle cx="18" cy="49" r="1.6" fill={spec.led} />
    </>
  );
}

/** The control strip of an amp: knobs and a jewel light. */
function Controls({ spec, y, x0, x1 }: { spec: RigIconSpec; y: number; x0: number; x1: number }) {
  return (
    <>
      {spread(spec.knobs, x0, x1).map((x) => (
        <Knob key={x} x={x} y={y} r={2.6} ink="#f5f5f7" />
      ))}
      <circle cx={x1 + 6} cy={y} r="1.8" fill={spec.led} />
    </>
  );
}

function Grille({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="2" fill="#3a3a3c" />
      <path
        d={spread(Math.round(h / 3), y + 2, y + h - 2)
          .map((v) => `M${x + 2} ${v}h${w - 4}`)
          .join('')}
        stroke="#636366"
        strokeWidth={0.7}
      />
    </>
  );
}

function Head({ spec }: { spec: RigIconSpec }) {
  return (
    <>
      <path d="M24 16v-4h16v4" fill="none" stroke="var(--rig-edge)" strokeWidth={2.2} strokeLinecap="round" />
      <rect x="4" y="16" width="56" height="34" rx="4" fill={spec.body} {...EDGE} />
      <Grille x={9} y={20} w={46} h={14} />
      <rect x="8" y="37" width="48" height="9" rx="1.5" fill="#c7ccd1" opacity={0.9} />
      <Controls spec={spec} y={41.5} x0={13} x1={46} />
    </>
  );
}

function Combo({ spec }: { spec: RigIconSpec }) {
  return (
    <>
      <path d="M24 8v-3h16v3" fill="none" stroke="var(--rig-edge)" strokeWidth={2.2} strokeLinecap="round" />
      <rect x="6" y="8" width="52" height="50" rx="4" fill={spec.body} {...EDGE} />
      <rect x="10" y="12" width="44" height="8" rx="1.5" fill="#c7ccd1" opacity={0.9} />
      <Controls spec={spec} y={16} x0={14} x1={42} />
      <Grille x={10} y={24} w={44} h={30} />
      <circle cx="32" cy="39" r="10" fill="none" stroke="#8e8e93" strokeOpacity={0.6} strokeWidth={1} />
    </>
  );
}

function Cab({ spec }: { spec: RigIconSpec }) {
  const cones =
    spec.speakers === 4
      ? [
          [23, 23],
          [41, 23],
          [23, 41],
          [41, 41],
        ]
      : spec.speakers === 2
        ? [
            [32, 22],
            [32, 42],
          ]
        : [[32, 32]];
  const r = spec.speakers === 1 ? 15 : 8.4;
  return (
    <>
      <rect x="6" y="6" width="52" height="52" rx="4" fill={spec.body} {...EDGE} />
      <rect x="10" y="10" width="44" height="44" rx="2" fill="#3a3a3c" />
      {cones.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r} fill="#2c2c2e" stroke="#8e8e93" strokeWidth={1} />
          <circle cx={x} cy={y} r={r * 0.3} fill="#636366" />
        </g>
      ))}
    </>
  );
}

function Rack({ spec }: { spec: RigIconSpec }) {
  const ink = inkOn(spec.body);
  return (
    <>
      <rect x="2" y="20" width="60" height="24" rx="2" fill={spec.body} {...EDGE} />
      {[5, 59].map((x) => [24, 40].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill={ink} opacity={0.5} />))}
      <rect x="10" y="25" width="14" height="8" rx="1" fill="#1c1c1e" />
      <path d="M12 30h3l2-3 2 4h3" stroke={spec.led} strokeWidth={1} fill="none" />
      {spread(spec.knobs, 30, 52).map((x) => (
        <Knob key={x} x={x} y={32} r={3} ink={ink} />
      ))}
      <circle cx="17" cy="38.5" r="1.5" fill={spec.led} />
    </>
  );
}

function Clone({ spec }: { spec: RigIconSpec }) {
  return (
    <>
      <rect x="12" y="10" width="46" height="30" rx="4" fill="none" stroke="var(--rig-edge)" strokeWidth={1.5} strokeDasharray="3 2.5" />
      <rect x="6" y="18" width="46" height="34" rx="4" fill={spec.body} {...EDGE} />
      <rect x="10" y="22" width="38" height="13" rx="2" fill="#1c1c1e" />
      <path d="M12 29c3-5 5-5 7.5 0s5 5 7.5 0 5-5 7.5 0 5 4 7.5 0" stroke={spec.led} strokeWidth={1.4} fill="none" strokeLinecap="round" />
      <Controls spec={spec} y={43} x0={12} x1={40} />
    </>
  );
}

function Ir({ spec }: { spec: RigIconSpec }) {
  const spikes = [22, 14, 10, 7, 5, 3.5, 2.5, 1.5];
  return (
    <>
      <rect x="6" y="10" width="52" height="44" rx="5" fill={spec.body} {...EDGE} />
      <rect x="10" y="14" width="44" height="30" rx="2" fill="#1c1c1e" />
      <path d="M12 38h40" stroke="#636366" strokeWidth={0.8} />
      {spikes.map((h, i) => (
        <path key={h} d={`M${15 + i * 5} 38v${-h}`} stroke={spec.led} strokeWidth={2} strokeLinecap="round" />
      ))}
      <circle cx="14" cy="49" r="1.6" fill={spec.led} />
      <path d="M20 49h30" stroke={inkOn(spec.body)} strokeOpacity={0.4} strokeWidth={1.4} strokeLinecap="round" />
    </>
  );
}

const DRAW: Record<RigIconSpec['category'], (p: { spec: RigIconSpec }) => ReactNode> = {
  drive: Stomp,
  comp: Stomp,
  mod: Stomp,
  delay: Stomp,
  reverb: Stomp,
  gate: Stomp,
  eq: Eq,
  treadle: Treadle,
  head: Head,
  combo: Combo,
  cab: Cab,
  rack: Rack,
  clone: Clone,
  ir: Ir,
};

export function RigIcon({ spec, size = 64 }: { spec: RigIconSpec; size?: number }) {
  const Draw = DRAW[spec.category];
  return (
    <svg className="rig-icon" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <Draw spec={spec} />
    </svg>
  );
}
