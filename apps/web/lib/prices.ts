/**
 * What a paid answer cost, estimated: OpenRouter's public model catalog (no key) gives the price
 * per token of nearly every model on the market, OpenAI, Claude, Gemini, Grok, DeepSeek, Mistral
 * and the open ones included. A provider's model id is matched to it ignoring case, punctuation and
 * the vendor prefix. Nothing is guessed: an unknown model has no cost shown.
 */
const CATALOG = 'https://openrouter.ai/api/v1/models';

export interface Price {
  /** US dollars per input token. */
  readonly input: number;
  /** US dollars per output token. */
  readonly output: number;
}

export type Prices = ReadonlyMap<string, Price>;

/** "anthropic/claude-haiku-5.5" and "claude-haiku-5-5" both give "claudehaiku55". */
const key = (id: string) =>
  id
    .toLowerCase()
    .replace(/:.*$/, '')
    .replace(/^.*\//, '')
    .replace(/[^a-z0-9]/g, '');

export function parsePrices(catalog: unknown): Prices {
  const prices = new Map<string, Price>();
  const models = (catalog as { data?: { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }[] })?.data ?? [];
  for (const m of models) {
    if (typeof m.id !== 'string' || m.id.includes(':')) continue; // ':batch', ':free' and the like are other offers
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    if (Number.isFinite(input) && Number.isFinite(output) && !prices.has(key(m.id))) prices.set(key(m.id), { input, output });
  }
  return prices;
}

/** A snapshot date at the end ("claude-haiku-4-5-20251001"): the catalog lists the model without it. */
const DATED = /[-_@]\d{8}$/;

export const priceOf = (prices: Prices, modelId: string): Price | null => prices.get(key(modelId)) ?? prices.get(key(modelId.replace(DATED, ''))) ?? null;

/** Tokens an answer used over its requests, and the cost when the provider reported it (OpenRouter). */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cost?: number;
}

/** US dollars, or null when neither the provider nor the catalog says. */
export function answerCost(usage: Usage, price: Price | null): number | null {
  if (usage.cost !== undefined) return usage.cost;
  if (!price || usage.input + usage.output === 0) return null;
  return usage.input * price.input + usage.output * price.output;
}

let loading: Promise<Prices> | null = null;

/** The catalog's prices, fetched once per page; empty when it cannot be read (no cost is shown then). */
export function loadPrices(fetchFn: typeof fetch = fetch): Promise<Prices> {
  loading ??= fetchFn(CATALOG)
    .then((r) => (r.ok ? r.json() : null))
    .then(parsePrices)
    .catch(() => {
      loading = null; // try again next time
      return new Map<string, Price>();
    });
  return loading;
}
