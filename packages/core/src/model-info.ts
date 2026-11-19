/**
 * What each model is, from the Pocket Master user manuals (firmware V1.0.1 and V1.3.0, effect
 * lists). `basedOn` is the real gear the manual says a model is based on; models the manual names
 * no gear for have none, and models added after V1.3.0 say so instead of guessing. Product names are
 * trademarks of their owners, used (as in the manual) only to identify the sound character.
 */
export interface ModelInfo {
  readonly basedOn?: string;
  readonly about: string;
}

type Table = Readonly<Record<string, ModelInfo>>;

const NOT_IN_MANUAL = 'Added after firmware V1.3.0; the manuals do not describe it.';

/** FX1 and FX2 share most models; `without` drops the ones a block lacks. */
const FX: Table = {
  'COMP 1': { basedOn: 'Ross Compressor', about: 'Compressor with sustain and volume.' },
  'COMP 2': { basedOn: 'Keeley C4 4-knob compressor', about: 'Compressor with sustain, attack, volume and clipping (input sensitivity).' },
  'Touch Wah': { about: 'Wide-range envelope filter: the wah follows how hard you play; guitar or bass mode.' },
  'Auto Wah': { about: 'Wah swept at a set rate, for guitar or bass.' },
  Boost: { basedOn: 'Xotic EP Booster', about: 'Clean boost with +3dB minimum and vintage/flat (Bright) character.' },
  'A-Chorus': { basedOn: 'Arion SCH-1 Stereo Chorus', about: 'Chorus with depth, rate and tone.' },
  'B-Chorus': { about: 'Vintage-voiced ensemble chorus tuned for bass players.' },
  Flanger: { about: 'Classic flanger with pre-delay and feedback.' },
  Phaser: { basedOn: 'MXR M101 Phase 90', about: 'Four-stage phaser with one rate control.' },
  Vibe: { basedOn: 'Voodoo Lab Micro Vibe', about: 'Uni-Vibe-style throb with depth and rate.' },
  Vibrato: { about: 'Pitch vibrato based on a BBD (bucket-brigade) blue vibrato pedal.' },
  Tremolo: { basedOn: 'Demeter TRM-1 Tremulator', about: 'Classic opto tremolo.' },
  'Sine Trem': { about: 'Sine-wave tremolo with a very wide range.' },
  'Bias Trem': { about: 'Bias (valve-style) tremolo with an adjustable waveform offset.' },
  Octave: { about: 'Polyphonic octave: one octave down and one up, mixed with the dry signal.' },
  Pitch: { about: 'Polyphonic pitch shifter / harmonizer, in semitones.' },
  Detune: { about: 'Slightly detuned copy (±50 cents) mixed with the dry signal, for a chorus-like doubling.' },
  'AC G': { about: 'Acoustic guitar simulator (AC Sim): Body (low resonance), Top (upper harmonics); Standard, Jumbo, Enhanced (attack) or Piezo pickup character.' },
};

function without(table: Table, ...names: string[]): Table {
  return Object.fromEntries(Object.entries(table).filter(([name]) => !names.includes(name)));
}

export const MODEL_INFO: Readonly<Record<string, Table>> = {
  nr: {
    Gate: { basedOn: 'ISP Decimator noise gate', about: 'Noise gate; THRE sets the trigger level.' },
  },
  fx1: without(FX, 'Octave', 'Pitch', 'Detune'),
  fx2: without(FX, 'AC G'),
  drv: {
    Scream: { basedOn: 'Ibanez TS-808 Tube Screamer', about: 'Mid-focused overdrive, often used to tighten high-gain amps.' },
    'Butter OD': { about: 'Overdrive based on the classic 2-knob yellow overdrive pedal.' },
    'JP Dist': { about: 'Distortion based on a classic orange three-knob distortion pedal.' },
    Shark: { basedOn: 'MI Audio Crunch Box', about: 'Amp-like high-gain distortion pedal.' },
    'Dark Mouse': { basedOn: 'ProCo The Rat (early LM308 op-amp version)', about: 'Classic hard-clipping distortion with a filter control.' },
    'Grey Fuzz': { basedOn: 'Sola Sound Tone Bender MkII', about: 'Vintage germanium-style fuzz.' },
    'Red Fuzz': { basedOn: 'Dallas-Arbiter Fuzz Face', about: 'Vintage fuzz.' },
    'Bass Drive': { about: `Bass overdrive with clean blend and bass/treble. ${NOT_IN_MANUAL}` },
  },
  amp: {
    'TWD Deluxe': { basedOn: 'Fender Tweed Deluxe', about: 'Small vintage Fender combo; breaks up early.' },
    'B-Man N': { basedOn: "Fender '59 Bassman, Normal channel", about: 'Vintage Fender, warm clean to crunch.' },
    'Dark Twin': { basedOn: "Fender '65 Twin Reverb", about: 'Loud, sparkling Fender clean.' },
    'Voks 30N': { basedOn: 'VOX AC30HW, Normal channel', about: 'British class-A chime.' },
    'Jazz 120': { basedOn: 'Roland JC-120 "Jazz Chorus" solid-state combo', about: 'Very clean, hi-fi solid-state.' },
    'Brit 45': { basedOn: 'Marshall JTM45, Normal channel', about: 'Early Marshall: warm, bluesy crunch.' },
    'Brit 50JP': { basedOn: 'Marshall JTM50 with jumped channels', about: 'Plexi-era Marshall rock crunch; two gain controls.' },
    'Brit 800': { basedOn: 'Marshall JCM800', about: 'Classic 80s Marshall hard rock / metal crunch.' },
    'B-Man B': { basedOn: "Fender '59 Bassman, Bright channel", about: 'Brighter vintage Fender crunch.' },
    'Voks 30TB': { basedOn: 'VOX AC30HW, Top Boost channel', about: 'Chimey British crunch; Cool/Hot character.' },
    'Sol 100 OD': { basedOn: 'Soldano SLO-100, Crunch channel', about: 'Hot-rodded crunch.' },
    'Dizzy VH': { basedOn: 'Diezel VH4, channel 3', about: 'Modern tight high gain.' },
    'Eng 120': { basedOn: 'ENGL Savage 120 E610', about: 'Aggressive modern German high gain.' },
    'Halen 51': { basedOn: 'Peavey 5150, Lead channel', about: 'Saturated 90s/2000s metal high gain.' },
    'Sol 100 LD': { basedOn: 'Soldano SLO-100, Overdrive channel', about: 'Smooth singing lead high gain.' },
    'Calif DualV': { basedOn: 'Mesa/Boogie Dual Rectifier, Vintage mode', about: 'Rectifier high gain, looser and warmer.' },
    'Calif DualM': { basedOn: 'Mesa/Boogie Dual Rectifier, Modern mode', about: 'Rectifier high gain, tight and scooped: 90s metal.' },
    'Eng Power': { basedOn: 'ENGL Powerball II E645/2, lead channel (channel 4)', about: 'Very high gain, tight modern metal.' },
    'Flyman B1+': { basedOn: 'Friedman "Brown Eye" BE-100, HBE channel', about: 'Boutique hot-rodded British high gain.' },
    'Bog XT': { basedOn: 'Bogner Ecstasy (XTC), red channel', about: 'Fiery boutique high gain.' },
    'A BassVT': { about: `Bass amp with 3-band EQ and selectable mid frequency. ${NOT_IN_MANUAL}` },
    'Voks Bass': { about: `Bass amp with bass and treble. ${NOT_IN_MANUAL}` },
  },
  ir: {
    'TWD 1x8': { basedOn: 'Fender Champ 1x8 cabinet', about: 'Tiny vintage combo speaker.' },
    'TWD-P 1x10': { basedOn: 'Fender Princeton 1x10 cabinet', about: 'Small vintage combo.' },
    'Viblux 1x12': { basedOn: 'Fender Vibrolux 1x12 cabinet', about: 'Vintage 1x12 combo.' },
    'Voks 1x12': { basedOn: 'VOX AC15 1x12 cabinet', about: 'British 1x12 combo.' },
    'TWD 2x12': { basedOn: 'custom Fender Tweed 2x10 cabinet', about: 'Vintage tweed cabinet.' },
    'Double 2x12': { basedOn: "Fender '65 Twin Reverb 2x12 cabinet", about: 'Open-back clean 2x12.' },
    'Star 2x12': { basedOn: 'Mesa/Boogie Lonestar 1x12 cabinet', about: 'Boutique combo cabinet.' },
    'Jazz 2x12': { basedOn: 'Roland JC-120 2x12 cabinet', about: 'Clean solid-state combo speakers.' },
    'BritGN 2x12': { basedOn: 'Marshall 2550 2x12 cabinet', about: 'British 2x12.' },
    'BritGN 4x12': { basedOn: 'Vintage Marshall 4x12 cabinet with Celestion Greenback speakers', about: 'Classic British 4x12.' },
    'Bog 4x12': { basedOn: 'Bogner 4x12 cabinet', about: 'Boutique high-gain 4x12.' },
    'Dizzy 4x12': { basedOn: 'Diezel 4x12 cabinet', about: 'Modern high-gain 4x12.' },
    'Halen 4x12': { basedOn: 'Peavey 6505 4x12 cabinet', about: 'Metal 4x12.' },
    'Sol 4x12': { basedOn: 'Soldano 4x12 cabinet', about: 'Hot-rod 4x12.' },
    'Dual 4x12': { basedOn: 'Mesa/Boogie Rectifier 4x12 cabinet', about: 'Tight, deep modern-metal 4x12.' },
  },
  eq: {
    'GT EQ 1': { about: '5-band guitar EQ: 125 Hz, 400 Hz, 800 Hz, 1.6 kHz, 4 kHz, and volume.' },
    'GT EQ 2': { about: '5-band guitar EQ: 100 Hz, 500 Hz, 1 kHz, 3 kHz, 6 kHz, and volume.' },
    'Bass EQ': { about: '5-band bass EQ: 50 Hz, 120 Hz, 400 Hz, 800 Hz, 4.5 kHz, and volume.' },
  },
  dly: {
    Pure: { about: 'Clean, precise digital delay.' },
    Slap: { about: 'Classic short slapback echo.' },
    Warm: { about: 'Warm delay with an analog feel.' },
    Mag: { about: 'Solid-state tape echo.' },
    Tube: { about: 'Tube-driven tape echo.' },
    Reverse: { about: 'Reversed repeats.' },
    Analog: { about: 'Vintage 1980s rack delay with slightly sample-reduced repeats.' },
    Sweep: { about: 'Delay whose repeats pass through a sweeping filter.' },
    'Ping Pong': { about: 'Stereo delay bouncing between left and right.' },
  },
  rvb: {
    Air: { about: 'Airy reverb with natural decay and high damping.' },
    Room: { about: 'Room reverb.' },
    Hall: { about: 'Concert hall reverb.' },
    Church: { about: 'Large church reverb.' },
    'Plate 1': { about: 'Large plate reverb.' },
    'Plate 2': { about: 'Vintage plate reverb with damping.' },
    Spring: { about: 'Vintage amp spring reverb.' },
    Light: { about: 'Lush, bright ambient reverb.' },
    Ocean: { about: 'Huge, deep ambient reverb.' },
    Dream: { about: 'Lush modulated reverb.' },
  },
};

export function modelInfo(blockKey: string, modelName: string): ModelInfo | undefined {
  return MODEL_INFO[blockKey]?.[modelName];
}
