/**
 * Plain-language guide to the models, for people who do not know the gear names: a short label
 * shown next to the pedal's own model name, the group a model is listed under, and the
 * description in Portuguese (English is `about` in model-info.ts). Labels name the real gear the
 * manual cites (as a reference to the sound, like the manual does) or say what the effect is.
 */
export type GuideLang = 'en' | 'pt';
type Text = Readonly<Record<GuideLang, string>>;

export interface ModelGuide {
  /** Group key, see GROUPS. */
  readonly group: string;
  readonly label: Text;
  /** The description in Portuguese. */
  readonly aboutPt: string;
}

/** Group names, in the order groups are listed. */
export const GROUPS: Readonly<Record<string, Text>> = {
  dynamics: { en: 'Compressor & boost', pt: 'Compressor e boost' },
  filter: { en: 'Wah & filter', pt: 'Wah e filtro' },
  modulation: { en: 'Modulation', pt: 'Modulação' },
  tremolo: { en: 'Tremolo', pt: 'Tremolo' },
  pitch: { en: 'Pitch & octave', pt: 'Afinação e oitava' },
  acoustic: { en: 'Acoustic', pt: 'Violão' },
  overdrive: { en: 'Overdrive', pt: 'Overdrive' },
  distortion: { en: 'Distortion', pt: 'Distorção' },
  fuzz: { en: 'Fuzz', pt: 'Fuzz' },
  clean: { en: 'Clean', pt: 'Limpo' },
  crunch: { en: 'Crunch', pt: 'Crunch' },
  highGain: { en: 'High gain', pt: 'High gain' },
  bass: { en: 'Bass', pt: 'Baixo' },
  oneSpeaker: { en: '1 speaker (small combos)', pt: '1 alto-falante (combos pequenos)' },
  twoSpeakers: { en: '2 speakers', pt: '2 alto-falantes' },
  fourSpeakers: { en: '4x12 cabinets', pt: 'Gabinetes 4x12' },
  userIr: { en: 'Your IRs', pt: 'Seus IRs' },
  guitarEq: { en: 'Guitar', pt: 'Guitarra' },
  digital: { en: 'Digital', pt: 'Digital' },
  analogTape: { en: 'Analog & tape', pt: 'Analógico e fita' },
  spaces: { en: 'Rooms & halls', pt: 'Salas e salões' },
  plateSpring: { en: 'Plate & spring', pt: 'Placa e mola' },
  ambient: { en: 'Ambient', pt: 'Ambiente' },
  gate: { en: 'Noise gate', pt: 'Noise gate' },
};

const g = (group: string, en: string, pt: string, aboutPt: string): ModelGuide => ({ group, label: { en, pt }, aboutPt });

const FX: Readonly<Record<string, ModelGuide>> = {
  'COMP 1': g('dynamics', 'Ross compressor', 'Compressor Ross', 'Compressor com sustain e volume.'),
  'COMP 2': g('dynamics', 'Keeley C4 compressor', 'Compressor Keeley C4', 'Compressor com sustain, ataque, volume e clipping (sensibilidade de entrada).'),
  'Touch Wah': g('filter', 'Wah that follows your picking', 'Wah que segue a palhetada', 'Filtro de envelope: o wah acompanha a força com que você toca; modo guitarra ou baixo.'),
  'Auto Wah': g('filter', 'Automatic wah', 'Wah automático', 'Wah que varre sozinho numa velocidade definida, para guitarra ou baixo.'),
  Boost: g('dynamics', 'Clean boost (Xotic EP)', 'Boost limpo (Xotic EP)', 'Boost limpo de no mínimo +3 dB, com caráter vintage ou plano (Bright).'),
  'A-Chorus': g('modulation', 'Arion chorus', 'Chorus Arion', 'Chorus com profundidade, velocidade e tom.'),
  'B-Chorus': g('modulation', 'Bass chorus', 'Chorus para baixo', 'Chorus vintage tipo ensemble, ajustado para baixistas.'),
  Flanger: g('modulation', 'Flanger', 'Flanger', 'Flanger clássico com pré-delay e realimentação.'),
  Phaser: g('modulation', 'MXR Phase 90', 'Phaser MXR Phase 90', 'Phaser de quatro estágios com um controle de velocidade.'),
  Vibe: g('modulation', 'Uni-Vibe', 'Uni-Vibe', 'Pulsação estilo Uni-Vibe com profundidade e velocidade.'),
  Vibrato: g('modulation', 'Vibrato', 'Vibrato', 'Vibrato de afinação, inspirado num pedal de vibrato BBD azul.'),
  Tremolo: g('tremolo', 'Opto tremolo (Demeter)', 'Tremolo óptico (Demeter)', 'Tremolo óptico clássico.'),
  'Sine Trem': g('tremolo', 'Smooth tremolo', 'Tremolo suave', 'Tremolo de onda senoidal com faixa bem ampla.'),
  'Bias Trem': g('tremolo', 'Tube-amp tremolo', 'Tremolo de amp valvulado', 'Tremolo tipo bias de amplificador valvulado, com deslocamento de onda ajustável.'),
  Octave: g('pitch', 'Octave up and down', 'Oitava acima e abaixo', 'Oitava polifônica: uma oitava abaixo e uma acima, misturadas ao som limpo.'),
  Pitch: g('pitch', 'Harmonizer', 'Harmonizador', 'Pitch shifter / harmonizador polifônico, em semitons.'),
  Detune: g('pitch', 'Detune (doubling)', 'Detune (dobra)', 'Cópia levemente desafinada (±50 cents) misturada ao som limpo, dobrando como um chorus.'),
  'AC G': g(
    'acoustic',
    'Acoustic guitar simulator',
    'Simulador de violão',
    'Simula um violão: Body (ressonância grave), Top (harmônicos agudos); captação Standard, Jumbo, Enhanced (ataque) ou Piezo.',
  ),
};

export const MODEL_GUIDE: Readonly<Record<string, Readonly<Record<string, ModelGuide>>>> = {
  nr: {
    Gate: g('gate', 'Noise gate (ISP Decimator)', 'Noise gate (ISP Decimator)', 'Corta o chiado quando você não toca; THRE define o nível de corte.'),
  },
  fx1: FX,
  fx2: FX,
  drv: {
    Scream: g('overdrive', 'Ibanez Tube Screamer', 'Ibanez Tube Screamer', 'Overdrive com médios na frente, muito usado para apertar amps de high gain.'),
    'Butter OD': g('overdrive', 'Boss OD-1 style', 'Estilo Boss OD-1', 'Overdrive inspirado no clássico pedal amarelo de dois knobs (o manual não o nomeia; a descrição é a do Boss OD-1).'),
    'JP Dist': g('distortion', 'Boss DS-1 style', 'Estilo Boss DS-1', 'Distorção inspirada num clássico pedal laranja de três knobs (o manual não o nomeia; a descrição é a do Boss DS-1).'),
    Shark: g('distortion', 'Crunch Box (amp in a box)', 'Crunch Box (Marshall em pedal)', 'Distorção de alto ganho com cara de amplificador Marshall, num pedal.'),
    'Dark Mouse': g('distortion', 'ProCo RAT', 'ProCo RAT', 'Distorção clássica de clipping forte, com controle de filtro.'),
    'Grey Fuzz': g('fuzz', 'Tone Bender fuzz', 'Fuzz Tone Bender', 'Fuzz vintage estilo germânio.'),
    'Red Fuzz': g('fuzz', 'Fuzz Face', 'Fuzz Face', 'Fuzz vintage.'),
    'Bass Drive': g('bass', 'Bass overdrive', 'Overdrive para baixo', 'Overdrive de baixo com mistura do som limpo, graves e agudos.'),
  },
  amp: {
    'TWD Deluxe': g('crunch', 'Fender Tweed Deluxe', 'Fender Tweed Deluxe', 'Combo Fender vintage pequeno; começa a saturar cedo.'),
    'B-Man N': g('clean', "Fender '59 Bassman", "Fender '59 Bassman", 'Fender vintage, do limpo quente ao crunch.'),
    'Dark Twin': g('clean', 'Fender Twin Reverb', 'Fender Twin Reverb', 'Limpo Fender alto e cristalino.'),
    'Voks 30N': g('clean', 'Vox AC30', 'Vox AC30', 'Brilho britânico classe A.'),
    'Jazz 120': g('clean', 'Roland Jazz Chorus', 'Roland Jazz Chorus', 'Transistorizado, limpíssimo e hi-fi.'),
    'Brit 45': g('crunch', 'Marshall JTM45', 'Marshall JTM45', 'Marshall antigo: crunch quente e bluesy.'),
    'Brit 50JP': g('crunch', 'Marshall Plexi (JTM50)', 'Marshall Plexi (JTM50)', 'Crunch de rock da era Plexi; dois controles de ganho.'),
    'Brit 800': g('crunch', 'Marshall JCM800', 'Marshall JCM800', 'O crunch Marshall dos anos 80, de hard rock a metal.'),
    'B-Man B': g('crunch', "Fender '59 Bassman (bright)", "Fender '59 Bassman (bright)", 'Crunch Fender vintage mais brilhante.'),
    'Voks 30TB': g('crunch', 'Vox AC30 Top Boost', 'Vox AC30 Top Boost', 'Crunch britânico cristalino; caráter Cool/Hot.'),
    'Sol 100 OD': g('crunch', 'Soldano SLO-100 (crunch)', 'Soldano SLO-100 (crunch)', 'Crunch envenenado.'),
    'Dizzy VH': g('highGain', 'Diezel VH4', 'Diezel VH4', 'High gain moderno e justo.'),
    'Eng 120': g('highGain', 'ENGL Savage 120', 'ENGL Savage 120', 'High gain alemão moderno e agressivo.'),
    'Halen 51': g('highGain', 'Peavey 5150', 'Peavey 5150', 'High gain saturado do metal dos anos 90 e 2000.'),
    'Sol 100 LD': g('highGain', 'Soldano SLO-100 (lead)', 'Soldano SLO-100 (solo)', 'High gain suave e cantado para solos.'),
    'Calif DualV': g('highGain', 'Mesa Dual Rectifier (vintage)', 'Mesa Dual Rectifier (vintage)', 'High gain Rectifier mais solto e quente.'),
    'Calif DualM': g('highGain', 'Mesa Dual Rectifier (modern)', 'Mesa Dual Rectifier (moderno)', 'High gain Rectifier justo e com médios cavados: metal dos anos 90.'),
    'Eng Power': g('highGain', 'ENGL Powerball', 'ENGL Powerball', 'Ganho altíssimo, metal moderno e justo.'),
    'Flyman B1+': g('highGain', 'Friedman BE-100', 'Friedman BE-100', 'High gain britânico envenenado, boutique.'),
    'Bog XT': g('highGain', 'Bogner Ecstasy', 'Bogner Ecstasy', 'High gain boutique e incendiário.'),
    'A BassVT': g('bass', 'Bass amp, 3-band EQ', 'Amp de baixo, EQ de 3 bandas', 'Amp de baixo com EQ de 3 bandas e frequência de médios selecionável.'),
    'Voks Bass': g('bass', 'Bass amp', 'Amp de baixo', 'Amp de baixo com graves e agudos.'),
  },
  ir: {
    'TWD 1x8': g('oneSpeaker', 'Fender Champ 1x8', 'Fender Champ 1x8', 'Alto-falante de combo vintage bem pequeno.'),
    'TWD-P 1x10': g('oneSpeaker', 'Fender Princeton 1x10', 'Fender Princeton 1x10', 'Combo vintage pequeno.'),
    'Viblux 1x12': g('oneSpeaker', 'Fender Vibrolux 1x12', 'Fender Vibrolux 1x12', 'Combo vintage 1x12.'),
    'Voks 1x12': g('oneSpeaker', 'Vox AC15 1x12', 'Vox AC15 1x12', 'Combo britânico 1x12.'),
    'Star 2x12': g('oneSpeaker', 'Mesa Lonestar 1x12', 'Mesa Lonestar 1x12', 'Caixa de combo boutique (1x12, apesar do nome).'),
    'TWD 2x12': g('twoSpeakers', 'Fender Tweed 2x10', 'Fender Tweed 2x10', 'Caixa tweed vintage (2x10, apesar do nome).'),
    'Double 2x12': g('twoSpeakers', 'Fender Twin Reverb 2x12', 'Fender Twin Reverb 2x12', 'Caixa aberta 2x12 para limpos.'),
    'Jazz 2x12': g('twoSpeakers', 'Roland Jazz Chorus 2x12', 'Roland Jazz Chorus 2x12', 'Alto-falantes de combo transistorizado limpo.'),
    'BritGN 2x12': g('twoSpeakers', 'Marshall 2x12', 'Marshall 2x12', 'Caixa britânica 2x12.'),
    'BritGN 4x12': g('fourSpeakers', 'Marshall 4x12 Greenback', 'Marshall 4x12 Greenback', 'A clássica caixa britânica 4x12.'),
    'Bog 4x12': g('fourSpeakers', 'Bogner 4x12', 'Bogner 4x12', 'Caixa 4x12 boutique para high gain.'),
    'Dizzy 4x12': g('fourSpeakers', 'Diezel 4x12', 'Diezel 4x12', 'Caixa 4x12 de high gain moderno.'),
    'Halen 4x12': g('fourSpeakers', 'Peavey 6505 4x12', 'Peavey 6505 4x12', 'Caixa 4x12 de metal.'),
    'Sol 4x12': g('fourSpeakers', 'Soldano 4x12', 'Soldano 4x12', 'Caixa 4x12 hot-rod.'),
    'Dual 4x12': g('fourSpeakers', 'Mesa Rectifier 4x12', 'Mesa Rectifier 4x12', 'Caixa 4x12 justa e profunda de metal moderno.'),
    ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`User IR ${n}`, g('userIr', 'Your IR file', 'Seu arquivo de IR', `Resposta de caixa que você carregou no slot de IR ${n}.`)])),
  },
  eq: {
    'GT EQ 1': g('guitarEq', 'Guitar EQ, 5 bands (125 Hz–4 kHz)', 'EQ de guitarra, 5 bandas (125 Hz–4 kHz)', 'EQ de guitarra de 5 bandas: 125 Hz, 400 Hz, 800 Hz, 1,6 kHz, 4 kHz, e volume.'),
    'GT EQ 2': g('guitarEq', 'Guitar EQ, 5 bands (100 Hz–6 kHz)', 'EQ de guitarra, 5 bandas (100 Hz–6 kHz)', 'EQ de guitarra de 5 bandas: 100 Hz, 500 Hz, 1 kHz, 3 kHz, 6 kHz, e volume.'),
    'Bass EQ': g('bass', 'Bass EQ, 5 bands', 'EQ de baixo, 5 bandas', 'EQ de baixo de 5 bandas: 50 Hz, 120 Hz, 400 Hz, 800 Hz, 4,5 kHz, e volume.'),
  },
  dly: {
    Pure: g('digital', 'Clean digital delay', 'Delay digital limpo', 'Delay digital limpo e preciso.'),
    Slap: g('digital', 'Slapback echo', 'Eco slapback', 'O clássico eco curto de slapback.'),
    'Ping Pong': g('digital', 'Stereo ping-pong', 'Pingue-pongue estéreo', 'Delay estéreo que alterna entre esquerda e direita.'),
    Reverse: g('digital', 'Reverse delay', 'Delay reverso', 'Repetições de trás para frente.'),
    Sweep: g('digital', 'Filtered delay', 'Delay com filtro', 'Delay cujas repetições passam por um filtro que varre.'),
    Warm: g('analogTape', 'Warm analog-style delay', 'Delay quente analógico', 'Delay quente com sensação analógica.'),
    Analog: g('analogTape', '80s rack delay', 'Delay de rack dos anos 80', 'Delay de rack vintage dos anos 80, com repetições levemente degradadas.'),
    Mag: g('analogTape', 'Tape echo', 'Eco de fita', 'Eco de fita transistorizado.'),
    Tube: g('analogTape', 'Tube tape echo', 'Eco de fita valvulado', 'Eco de fita com circuito valvulado.'),
  },
  rvb: {
    Room: g('spaces', 'Room', 'Sala', 'Reverb de sala.'),
    Hall: g('spaces', 'Concert hall', 'Salão de concerto', 'Reverb de salão de concerto.'),
    Church: g('spaces', 'Church', 'Igreja', 'Reverb de uma igreja grande.'),
    Air: g('spaces', 'Airy natural space', 'Espaço natural arejado', 'Reverb arejado, com decaimento natural e agudos amortecidos.'),
    'Plate 1': g('plateSpring', 'Large plate', 'Placa grande', 'Reverb de placa grande.'),
    'Plate 2': g('plateSpring', 'Vintage plate', 'Placa vintage', 'Reverb de placa vintage com amortecimento.'),
    Spring: g('plateSpring', 'Amp spring reverb', 'Mola de amplificador', 'Reverb de mola de amplificador vintage.'),
    Light: g('ambient', 'Bright ambient', 'Ambiente brilhante', 'Reverb ambiente exuberante e brilhante.'),
    Ocean: g('ambient', 'Huge deep ambient', 'Ambiente enorme e profundo', 'Reverb ambiente enorme e profundo.'),
    Dream: g('ambient', 'Modulated ambient', 'Ambiente modulado', 'Reverb exuberante com modulação.'),
  },
};

export function modelGuide(blockKey: string, modelName: string): ModelGuide | undefined {
  return MODEL_GUIDE[blockKey]?.[modelName];
}

export interface ModelGroup<T> {
  /** Group name in `lang`, or null for models without a guide entry. */
  readonly name: string | null;
  readonly models: readonly T[];
}

/** `models` grouped in GROUPS order (catalog order inside a group); unknown models last, unnamed. */
export function groupModels<T extends { readonly name: string }>(blockKey: string, models: readonly T[], lang: GuideLang): ModelGroup<T>[] {
  const keyOf = (m: T) => modelGuide(blockKey, m.name)?.group ?? null;
  const keys = [...Object.keys(GROUPS), null];
  return keys.map((key) => ({ name: key === null ? null : (GROUPS[key] as Text)[lang], models: models.filter((m) => keyOf(m) === key) })).filter((group) => group.models.length > 0);
}
