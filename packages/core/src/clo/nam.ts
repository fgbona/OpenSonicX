/**
 * .nam (Neural Amp Modeler) parsing: classic WaveNet, the v0.7.0 schema and TONE3000's
 * SlimmableContainer. Only what the pedal's clone engine can be fitted from is accepted.
 *
 * Ported to TypeScript from SonicMaster (github.com/skyggedans/SonicMaster, MIT; clo_dsp.dart at
 * 931a68f, itself a port of its Rust generator).
 */

export type Activation = { readonly kind: 'tanh' } | { readonly kind: 'leaky'; readonly slope: number };

export interface WavenetLayer {
  /** Per tap k: [out][in]. */
  readonly convW: readonly (readonly Float64Array[])[];
  readonly convB: Float64Array;
  /** [channels][condition]. */
  readonly mixinW: readonly Float64Array[];
  /** [channels][channels]. */
  readonly outW: readonly Float64Array[];
  readonly outB: Float64Array;
  readonly dilation: number;
  readonly act: Activation;
}

export interface WavenetLayerArray {
  /** [channels][input]. */
  readonly rechannelW: readonly Float64Array[];
  readonly layers: readonly WavenetLayer[];
  /** Head rechannel conv1d, per tap: [headOut][channels]. */
  readonly headW: readonly (readonly Float64Array[])[];
  readonly headB: Float64Array;
  readonly channels: number;
}

export interface Wavenet {
  readonly arrays: readonly WavenetLayerArray[];
  readonly headScale: number;
}

type Json = Record<string, unknown>;

const num = (v: Json, key: string): number => {
  const x = v[key];
  if (typeof x !== 'number') throw new Error(`.nam: "${key}" must be a number`);
  return Math.trunc(x);
};

class Cursor {
  #pos = 0;
  readonly #w: readonly number[];
  constructor(weights: readonly number[]) {
    this.#w = weights;
  }
  take(n: number): Float64Array {
    if (this.#pos + n > this.#w.length) throw new Error('.nam: fewer weights than the model needs');
    const s = Float64Array.from(this.#w.slice(this.#pos, this.#pos + n));
    this.#pos += n;
    return s;
  }
  /** Conv1d weights: PyTorch flatten [out][in][k], then bias[out]. */
  conv1d(cin: number, cout: number, ks: number, bias: boolean): [Float64Array[][], Float64Array] {
    const raw = this.take(cout * cin * ks);
    const kernels = Array.from({ length: ks }, (_, k) =>
      Array.from({ length: cout }, (_, o) => Float64Array.from({ length: cin }, (_, i) => raw[(o * cin + i) * ks + k]!)),
    );
    return [kernels, bias ? this.take(cout) : new Float64Array(cout)];
  }
  /** Conv1x1: row-major (out, in), then bias[out]. */
  conv1x1(cin: number, cout: number, bias: boolean): [Float64Array[], Float64Array | null] {
    const raw = this.take(cout * cin);
    const m = Array.from({ length: cout }, (_, o) => raw.slice(o * cin, (o + 1) * cin));
    return [m, bias ? this.take(cout) : null];
  }
  get remaining(): number {
    return this.#w.length - this.#pos;
  }
}

const featureActive = (v: unknown): boolean => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json).active === true : v !== undefined && v !== null);

const FILM_KEYS = [
  'conv_pre_film', 'conv_post_film', 'input_mixin_pre_film', 'input_mixin_post_film', 'activation_pre_film',
  'activation_post_film', 'layer1x1_post_film', 'head1x1_post_film', 'film_params',
];

function assertSupported(la: Json): void {
  const gating = la.gating_mode;
  if (la.gated === true || (Array.isArray(gating) && gating.some((v) => v !== 'none'))) throw new Error('gated WaveNet captures are not supported');
  if (typeof la.bottleneck === 'number' && Math.trunc(la.bottleneck) !== num(la, 'channels')) throw new Error('WaveNet bottleneck captures are not supported');
  if (featureActive(la.head1x1) || featureActive(la.head_1x1_config)) throw new Error('WaveNet head 1x1 captures are not supported');
  if (FILM_KEYS.some((k) => featureActive(la[k]))) throw new Error('WaveNet FiLM captures are not supported');
}

function parseAct(v: unknown): Activation {
  const name = typeof v === 'string' ? v : v && typeof v === 'object' ? (((v as Json).type as string | undefined) ?? 'Tanh') : 'Tanh';
  if (name === 'Tanh') return { kind: 'tanh' };
  if (name === 'ReLU') return { kind: 'leaky', slope: 0 };
  if (name === 'LeakyReLU') {
    const slope = v && typeof v === 'object' ? (v as Json).negative_slope : undefined;
    return { kind: 'leaky', slope: typeof slope === 'number' ? slope : 0.01 };
  }
  throw new Error(`unsupported activation "${name}"`);
}

function layerActs(cfg: Json, n: number): Activation[] {
  const a = cfg.activation;
  if (Array.isArray(a)) return a.map(parseAct);
  return Array.from({ length: n }, () => (a !== undefined && a !== null ? parseAct(a) : { kind: 'tanh' as const }));
}

/** Unwraps a SlimmableContainer to its highest-quality submodel (the last of equal maxima). */
function effectiveModel(root: Json): { config: Json; weights: number[] } {
  if (root.architecture === 'SlimmableContainer') {
    const subs = ((root.config as Json | undefined)?.submodels ?? []) as Json[];
    if (subs.length === 0) throw new Error('.nam: empty SlimmableContainer');
    let best = subs[0]!;
    let bestVal = typeof best.max_value === 'number' ? best.max_value : 0;
    for (const s of subs) {
      const v = typeof s.max_value === 'number' ? s.max_value : 0;
      if (v >= bestVal) {
        best = s;
        bestVal = v;
      }
    }
    return effectiveModel(best.model as Json);
  }
  if (root.architecture !== undefined && root.architecture !== 'WaveNet') {
    throw new Error(`only WaveNet captures can be converted for the pedal (this one is ${String(root.architecture)})`);
  }
  const weights = root.weights;
  if (!Array.isArray(weights) || weights.some((w) => typeof w !== 'number')) throw new Error('.nam: weights must be a list of numbers');
  if (!root.config || typeof root.config !== 'object') throw new Error('.nam: missing config');
  return { config: root.config as Json, weights: weights as number[] };
}

/** Parses .nam JSON text into a WaveNet the converter can run. */
export function parseNam(text: string): Wavenet {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('not a .nam file (invalid JSON)');
  }
  if (!root || typeof root !== 'object') throw new Error('not a .nam file');
  const { config, weights } = effectiveModel(root as Json);
  const cur = new Cursor(weights);
  const headScale = typeof config.head_scale === 'number' ? config.head_scale : 1;
  const layersCfg = config.layers;
  if (!Array.isArray(layersCfg) || layersCfg.length === 0) throw new Error('.nam: config.layers missing');

  const arrays = (layersCfg as Json[]).map((la): WavenetLayerArray => {
    assertSupported(la);
    const inputSize = num(la, 'input_size');
    const conditionSize = num(la, 'condition_size');
    const channels = num(la, 'channels');
    const dilations = (la.dilations as unknown[]).map((d) => Math.trunc(Number(d)));
    const kernels = Array.isArray(la.kernel_sizes)
      ? (la.kernel_sizes as unknown[]).map((k) => Math.trunc(Number(k)))
      : dilations.map(() => num(la, 'kernel_size'));
    const head = la.head;
    const [headOut, headKs, headBias] = head && typeof head === 'object'
      ? [num(head as Json, 'out_channels'), num(head as Json, 'kernel_size'), ((head as Json).bias as boolean | undefined) ?? true]
      : [num(la, 'head_size'), 1, (la.head_bias as boolean | undefined) ?? false];
    const acts = layerActs(la, dilations.length);
    const [rechannelW] = cur.conv1x1(inputSize, channels, false);
    const layers = dilations.map((dilation, li): WavenetLayer => {
      const [convW, convB] = cur.conv1d(channels, channels, kernels[li]!, true);
      const [mixinW] = cur.conv1x1(conditionSize, channels, false);
      const [outW, outB] = cur.conv1x1(channels, channels, true);
      return { convW, convB, mixinW, outW, outB: outB!, dilation, act: acts[li] ?? { kind: 'tanh' } };
    });
    const [headW, headB] = cur.conv1d(channels, headOut, headKs, headBias);
    return { rechannelW, layers, headW, headB, channels };
  });
  return { arrays, headScale };
}
