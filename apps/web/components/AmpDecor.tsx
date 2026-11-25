import { AmpTube } from './AmpTube';

interface Props {
  on: boolean;
  /** The amp's gain as 0..1: how hot the tube glows. */
  drive: number;
  /** Changes with the amp model, so a new model warms its tube up again. */
  tubeKey: number;
  /** False for solid-state amps: no power tube to light. */
  tube: boolean;
}

/** Faceplate details of an AMP panel (both pedals' editors): screws, top vent, a lit power tube and the speaker grille. */
export function AmpDecor({ on, drive, tubeKey, tube }: Props) {
  return (
    <>
      <span className="amp-screw amp-screw-tl" aria-hidden="true" />
      <span className="amp-screw amp-screw-tr" aria-hidden="true" />
      <span className="amp-screw amp-screw-bl" aria-hidden="true" />
      <span className="amp-screw amp-screw-br" aria-hidden="true" />
      <span className="amp-vent" aria-hidden="true" />
      {tube ? <AmpTube key={tubeKey} on={on} drive={drive} /> : <span className="amp-tube" aria-hidden="true" />}
      <span className="amp-grille" aria-hidden="true" />
    </>
  );
}
