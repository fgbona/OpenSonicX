/**
 * The faceplate finish for each amp model: the materials and colours of the gear it is based on
 * (tweed, a gold Marshall panel, Rectifier diamond plate…), never a maker's logo. Captured
 * profiles and unknown models keep the plain plate.
 */
export type AmpSkin =
  | 'tweed' | 'blackface' | 'vox' | 'marshall' | 'mesa' | 'hotrod' | 'metal' | 'german' | 'boutique' | 'jazz' | 'bass';

const SKINS: Readonly<Record<string, AmpSkin>> = {
  'TWD Deluxe': 'tweed', 'B-Man N': 'tweed', 'B-Man B': 'tweed',
  'Dark Twin': 'blackface',
  'Voks 30N': 'vox', 'Voks 30TB': 'vox',
  'Brit 45': 'marshall', 'Brit 50JP': 'marshall', 'Brit 800': 'marshall',
  'Calif DualV': 'mesa', 'Calif DualM': 'mesa',
  'Sol 100 OD': 'hotrod', 'Sol 100 LD': 'hotrod',
  'Halen 51': 'metal',
  'Eng 120': 'german', 'Eng Power': 'german', 'Dizzy VH': 'german',
  'Bog XT': 'boutique', 'Flyman B1+': 'boutique',
  'Jazz 120': 'jazz',
  'A BassVT': 'bass', 'Voks Bass': 'bass',
};

/** The finish for an amp model name, or null for the plain plate. */
export function ampSkin(modelName: string | undefined): AmpSkin | null {
  return (modelName && SKINS[modelName]) || null;
}

/** Solid-state amps have no power tube to light. */
export const hasTube = (skin: AmpSkin | null) => skin !== 'jazz';
