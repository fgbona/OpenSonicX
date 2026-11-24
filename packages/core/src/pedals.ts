/**
 * The pedals the editors support, told apart by their USB MIDI port name. The Pocket Master comes
 * first: when both are plugged in, the editor picks it, as it did before the Matribox was supported.
 */
export type PedalKind = 'pocket-master' | 'matribox';

const PORTS: readonly (readonly [PedalKind, RegExp])[] = [
  ['pocket-master', /pocket\s*master/i],
  ['matribox', /matribox\s*ii\s*pro/i],
];

/** Which supported pedal a MIDI port belongs to, null for any other device. */
export function pedalOfPort(name: string | null | undefined): PedalKind | null {
  return PORTS.find(([, port]) => port.test(name ?? ''))?.[0] ?? null;
}
