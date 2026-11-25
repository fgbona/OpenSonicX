/**
 * One drawing per block, in the editor's own line style: the stroke takes the block's tint
 * (currentColor), the body a soft fill of it. 48 x 48 viewBox.
 */
const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const BODY = { fill: 'currentColor', fillOpacity: 0.16, stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' } as const;

/** A stompbox: body, footswitch and `knobs` knobs on top. */
function Stomp({ knobs, children }: { knobs: number; children?: React.ReactNode }) {
  const xs = knobs === 1 ? [24] : knobs === 2 ? [18, 30] : [15, 24, 33];
  return (
    <>
      <rect x="11" y="6" width="26" height="36" rx="4" {...BODY} />
      {xs.map((x) => (
        <circle key={x} cx={x} cy="13" r="2.6" {...STROKE} />
      ))}
      {children}
      <circle cx="24" cy="34" r="3.4" {...STROKE} />
    </>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  // noise gate: a stompbox with a gate step
  nr: (
    <Stomp knobs={1}>
      <path d="M16 25h4v-5h8v5h4" {...STROKE} />
    </Stomp>
  ),
  // modulation / dynamics: a stompbox with a wave
  fx1: (
    <Stomp knobs={2}>
      <path d="M15 23c2.2-4.5 4.4-4.5 6.5 0s4.3 4.5 6.5 0 4.3-4.5 6 0" {...STROKE} />
    </Stomp>
  ),
  fx2: (
    <Stomp knobs={2}>
      <path d="M15 23c2.2-4.5 4.4-4.5 6.5 0s4.3 4.5 6.5 0 4.3-4.5 6 0" {...STROKE} />
    </Stomp>
  ),
  // drive: three knobs and a clipped wave
  drv: (
    <Stomp knobs={3}>
      <path d="M15 25l3-5h5l2 5h4l3-5" {...STROKE} />
    </Stomp>
  ),
  // amp head: handle, grille cloth, control row
  amp: (
    <>
      <path d="M19 10v-3h10v3" {...STROKE} />
      <rect x="5" y="10" width="38" height="28" rx="4" {...BODY} />
      <rect x="9" y="14" width="30" height="12" rx="2" {...STROKE} />
      <path d="M12 18h24M12 22h24" {...STROKE} strokeWidth={1.2} />
      {[13, 19, 25, 31].map((x) => (
        <circle key={x} cx={x} cy="32" r="1.8" {...STROKE} />
      ))}
      <circle cx="37" cy="32" r="1.4" fill="currentColor" />
    </>
  ),
  // cabinet: box with two speakers
  ir: (
    <>
      <rect x="8" y="5" width="32" height="38" rx="3" {...BODY} />
      <circle cx="24" cy="15" r="6.5" {...STROKE} />
      <circle cx="24" cy="15" r="2" {...STROKE} />
      <circle cx="24" cy="32" r="6.5" {...STROKE} />
      <circle cx="24" cy="32" r="2" {...STROKE} />
    </>
  ),
  // equalizer: five faders
  eq: (
    <>
      <rect x="6" y="6" width="36" height="36" rx="4" {...BODY} />
      {[
        [13, 28],
        [19, 18],
        [24, 24],
        [29, 15],
        [35, 21],
      ].map(([x, y]) => (
        <g key={x}>
          <path d={`M${x} 11v26`} {...STROKE} strokeWidth={1.2} />
          <rect x={x! - 2.5} y={y! - 2} width="5" height="4" rx="1" fill="currentColor" />
        </g>
      ))}
    </>
  ),
  // delay: repeats getting quieter
  dly: (
    <>
      {[
        [9, 16],
        [17, 12],
        [25, 9],
        [33, 6],
        [40, 4],
      ].map(([x, h]) => (
        <path key={x} d={`M${x} ${24 - h!}v${2 * h!}`} {...STROKE} strokeWidth={3} />
      ))}
      <path d="M6 40h36" {...STROKE} strokeWidth={1.2} opacity={0.5} />
    </>
  ),
  // reverb: waves spreading out
  rvb: (
    <>
      <circle cx="12" cy="24" r="3" fill="currentColor" />
      {[8, 14, 20, 26].map((r, i) => (
        <path key={r} d={`M${12 + r * 0.7} ${24 - r * 0.7}a${r} ${r} 0 0 1 0 ${r * 1.4}`} {...STROKE} opacity={1 - i * 0.2} />
      ))}
    </>
  ),
};

/** A box with an arrow leaving it, entering it, or both: the effects loop. */
function Loop({ send, ret }: { send: boolean; ret: boolean }) {
  return (
    <>
      <rect x="6" y="14" width="16" height="20" rx="3" {...BODY} />
      {send && <path d={ret ? 'M22 19h18m-5-4 5 4-5 4' : 'M22 24h18m-5-5 5 5-5 5'} {...STROKE} />}
      {ret && <path d={send ? 'M42 29H24m5-4-5 4 5 4' : 'M42 24H24m5-5-5 5 5 5'} {...STROKE} />}
    </>
  );
}

/** The Matribox II Pro's modules that the Pocket Master has no block for; the others share its drawings. */
const MATRIBOX_ICONS: Record<string, React.ReactNode> = {
  // dynamics: a stompbox with a compressor's knee
  dyn: (
    <Stomp knobs={2}>
      <path d="M15 27l7-7h11" {...STROKE} />
    </Stomp>
  ),
  // pitch and frequency: a stompbox with an arrow up and one down
  freq: (
    <Stomp knobs={1}>
      <path d="M19 27v-8m-3 3 3-3 3 3M29 19v8m-3-3 3 3 3-3" {...STROKE} />
    </Stomp>
  ),
  // wah: a rocker pedal seen from the side
  wah: (
    <>
      <path d="M7 35h34v6H7z" {...BODY} />
      <path d="M8 31 37 14l3 6-29 15z" {...BODY} />
      <circle cx="26" cy="31" r="2" fill="currentColor" />
    </>
  ),
  mod: ICONS.fx1,
  // cabinet: one large speaker
  cab: (
    <>
      <rect x="7" y="7" width="34" height="34" rx="3" {...BODY} />
      <circle cx="24" cy="24" r="11" {...STROKE} />
      <circle cx="24" cy="24" r="3.5" {...STROKE} />
    </>
  ),
  // capture of an amp: an amp head and its copy behind it
  clone: (
    <>
      <path d="M12 13V9h29v19h-4" {...STROKE} opacity={0.6} />
      <rect x="6" y="16" width="30" height="22" rx="3" {...BODY} />
      <path d="M11 24c2.5-4 5-4 7.5 0s5 4 7.5 0 3.5-3 5-1" {...STROKE} />
      <path d="M11 32h20" {...STROKE} strokeWidth={1.2} />
    </>
  ),
  fxloop: <Loop send ret />,
  fxsnd: <Loop send ret={false} />,
  fxrtn: <Loop send={false} ret />,
  // volume: a ramp
  vol: (
    <>
      <path d="M7 38h34V12z" {...BODY} />
      <path d="M18 38v-8M28 38V22" {...STROKE} strokeWidth={1.2} />
    </>
  ),
};

export function ModuleIcon({ blockKey, size = 40 }: { blockKey: string; size?: number }) {
  return (
    <svg className="module-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {ICONS[blockKey] ?? MATRIBOX_ICONS[blockKey] ?? <rect x="10" y="10" width="28" height="28" rx="4" {...BODY} />}
    </svg>
  );
}
