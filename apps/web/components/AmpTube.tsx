import type { CSSProperties } from 'react';

/**
 * The power tube on the AMP faceplate: an illustration the project's owner generated, as a PNG
 * with real transparency (alpha taken from the brightness of its black background). Two copies:
 * a cold one (the glass, always there) and a hot one whose opacity is the tube's heat. Off: dark.
 * On: it warms up over about 1.5 s (also on mount, so a new amp model warms up too), glows
 * brighter with more gain, and breathes gently.
 */
export function AmpTube({ on, drive }: { on: boolean; drive: number }) {
  const src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/amp-tube.png`;
  const heat = on ? 0.45 + 0.55 * Math.min(1, Math.max(0, drive)) : 0;
  return (
    <span className={`amp-tube${on ? ' is-on' : ''}`} style={{ '--tube-heat': heat } as CSSProperties} aria-hidden="true">
      <img className="amp-tube-cold" src={src} alt="" width={200} height={344} />
      <span className="amp-tube-hot"><img src={src} alt="" width={200} height={344} /></span>
    </span>
  );
}
