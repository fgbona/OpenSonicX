/**
 * What the tone assistant's providers share, and the router between them. Conversations keep only
 * the texts (the person's messages and the answers); every request carries the preset as it is now,
 * so any provider can take the next message. Free quotas: Groq first (about 1,000 requests a day),
 * then Gemini Flash, then Gemini Flash-Lite; a used-up model hands the message to the next.
 */
import type { ChatTool, Difference, JsonSchema } from '@pocket-master/core';

/** Paid providers, each used with the model the person picked (providers.ts). */
export type PaidId = 'openrouter' | 'anthropic' | 'openai' | 'gemini-paid' | 'groq-paid' | 'xai' | 'deepseek' | 'mistral' | 'cerebras';
export type Provider = 'groq' | 'gemini' | PaidId;
/** A model the router can use: the free ones, or a paid provider with its picked model. */
export type AiModel = 'groq' | 'flash' | 'lite' | PaidId;
/** The free models, in the order they are tried. */
export const ROUTE: readonly AiModel[] = ['groq', 'flash', 'lite'];
export const providerOf = (model: AiModel): Provider => (model === 'flash' || model === 'lite' ? 'gemini' : model);

/** One message of the conversation as text; tool calls stay inside the request that made them. */
export interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

// "grave" alone is also "low-pitched" in Portuguese, so it counts only as "grave no/na/em".
export const SAVE_VERB = /\b(salv\w*|save|store|gravar?|grave\s+(?:no|na|em)\b)/i;
const SLOT_WORD = /\b(?:p|preset|slot)\s*0?(\d{1,2})\b/i;
const SLOT_AFTER = /\b(?:no|na|em|in|to|into)\s+0?(\d{1,2})\b/i;

/**
 * The user slot (0-based) a message asks to save in ("salve no p47", "save it to P45"), or null.
 * Weaker models sometimes say "saved" without proposing the save; the editor opens it instead.
 */
export function askedToSave(message: string): number | null {
  if (!SAVE_VERB.test(message)) return null;
  const slot = Number((SLOT_WORD.exec(message) ?? SLOT_AFTER.exec(message))?.[1]);
  return slot >= 1 && slot <= 50 ? slot - 1 : null;
}

/** Model requests per message: a tone takes one or two; more means the model is going in circles. */
export const MAX_REQUESTS = 6;

/** The model used every request of a message without answering. */
export class StepLimitError extends Error {
  constructor() {
    super('The assistant took too many steps for one message.');
  }
}

/** The same tool failed twice in one message: the message stops there, with the tool and its last error. */
export class ToolLoopError extends Error {
  readonly tool: string;
  readonly reason: string;
  constructor(tool: string, reason: string) {
    super(`${tool} failed twice: ${reason}`);
    this.tool = tool;
    this.reason = reason;
  }
}

/**
 * The agent's tool runner for one message, stopped (ToolLoopError) the second time the same tool
 * fails: a model retrying a failing write only repeats it until the step limit.
 */
export function guardedRunner(agent: ToneAgent): (name: string, args: unknown) => Promise<{ ok: boolean; text: string }> {
  const run = agent.runner();
  const failed = new Set<string>();
  return async (name, args) => {
    const result = await run(name, args);
    if (!result.ok) {
      if (failed.has(name)) throw new ToolLoopError(name, result.text.replace(/^Error:\s*/, ''));
      failed.add(name);
    }
    return result;
  };
}

/** The model's free quota is used up; it takes requests again at `retryAt`. */
export class QuotaError extends Error {
  readonly retryAt: Date;
  /** The model that ran out, when one ran out after it had already changed the pedal. */
  readonly model?: AiModel;
  /** True when the sound had already changed: the request was only partly done. */
  readonly partial: boolean;
  constructor(retryAt: Date, stopped?: { model: AiModel }) {
    super('The free quota is used up for now.');
    this.retryAt = retryAt;
    this.model = stopped?.model;
    this.partial = stopped !== undefined;
  }
}

/** The model is overloaded for now (Google's "high demand", Groq's 503): it is paused like a used-up quota, briefly. */
export class BusyError extends QuotaError {
  constructor(retryAt: Date, stopped?: { model: AiModel }) {
    super(retryAt, stopped);
    this.message = 'The model is busy right now.';
  }
}

/** How long an overloaded model is skipped. */
export const BUSY_WAIT_MS = 30_000;

/** How long one model request may take; a tone usually answers within seconds. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Sends a model request that gives up after `timeoutMs`: an overloaded provider sometimes never answers. */
export async function post(fetchFn: typeof fetch, url: string, init: RequestInit, now: () => Date, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new BusyError(new Date(now().getTime() + BUSY_WAIT_MS));
    throw error;
  }
}

/**
 * What the assistant works on: one pedal's tools, instructions and preset text, and the editor's
 * side of a message (what changed, the Save dialog). The providers and the panel only see this.
 */
export interface ToneAgent {
  readonly tools: readonly ChatTool[];
  /** Tools whose success changes the pedal (or opens the Save dialog): a request that ran one is not repeated elsewhere. */
  readonly acts: ReadonlySet<string>;
  /** The system instructions; paid providers get the thorough ones. */
  instructions(thorough: boolean): string;
  /** The first message's context: the loaded preset and the models to pick from. */
  context(thorough: boolean): string;
  /** The loaded preset as it is now. */
  current(): string;
  /** Runs the tools of one message; it refuses sound changes once the person loads another preset. */
  runner(): (name: string, args: unknown) => Promise<{ ok: boolean; text: string }>;
  /** Called as a message is sent; the function it returns lists what the answer changed (undefined: another preset is loaded now). */
  watch(off: string): (moved: { loaded: boolean; saved: boolean }) => readonly Difference[] | undefined;
  /** The message asked to save in a slot the model did not propose: opens the Save dialog and returns the slot's label, else null. */
  offerSave(message: string): string | null;
}

/** The provider refused the key itself (wrong, deleted, or not allowed). */
export class KeyError extends Error {
  readonly provider: Provider;
  constructor(provider: Provider, message: string) {
    super(message);
    this.provider = provider;
  }
}

/** Google does not offer the Gemini API (or its free tier) where the person is. */
export class RegionError extends Error {}

/**
 * The new message's text for the first request, and for the later ones of the same message: the
 * model list goes only once (the model has picked by then, and list_models is there), which keeps
 * a tone within Groq's free tokens a minute and a day.
 */
export function requestTexts(agent: ToneAgent, turns: readonly Turn[], message: string, language?: string, thorough = false): { first: string; later: string } {
  const tail = `\n\nRequest: ${message}${language ? `\n\nAnswer in ${language}.` : ''}`;
  const later = `${turns.length === 0 ? 'Loaded preset' : 'Loaded preset now'}:\n${agent.current()}${tail}`;
  return { first: turns.length === 0 ? `${agent.context(thorough)}${tail}` : later, later };
}

/**
 * Tool parameters in the JSON Schema subset both APIs document: unions as anyOf, constants as
 * one-value enums. Not valid for an OpenAI-style "strict" mode (top-level anyOf, type unions).
 */
export function toToolSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.oneOf) out.anyOf = s.oneOf.map(toToolSchema);
  if (Array.isArray(s.type)) out.anyOf = s.type.map((type) => ({ type }));
  else if (s.type) out.type = s.type;
  if (s.const !== undefined) out.enum = [s.const];
  if (s.description) out.description = s.description;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toToolSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toToolSchema(s.items);
  if (s.minimum !== undefined) out.minimum = s.minimum;
  if (s.maximum !== undefined) out.maximum = s.maximum;
  return out;
}

export interface ConverseOptions {
  readonly key: string;
  readonly model: AiModel;
  readonly turns: readonly Turn[];
  readonly message: string;
  readonly agent: ToneAgent;
  /** The editor's language; models otherwise drift to English, the language of the preset text. */
  readonly language?: string;
  /** Pauses inside a message (a short per-minute limit); tests pass a fake. */
  readonly wait?: (ms: number) => Promise<void>;
  /** Paid providers: the full model descriptions and the more thorough instructions (no free-plan token budget). */
  readonly thorough?: boolean;
  /** Each request's token usage, and its cost in US dollars when the provider reports it. */
  readonly onUsage?: (input: number, output: number, cost?: number) => void;
  readonly fetchFn?: typeof fetch;
  /** Called before every request, for the usage meter. */
  readonly onRequest: () => void;
  /** Called after each tool the model ran, with whether it worked. */
  readonly onStep?: (tool: string, ok: boolean, text: string) => void;
  /** Requests left today and the daily limit, when the provider says. */
  readonly onLimits?: (remaining: number, limit: number) => void;
  readonly now?: () => Date;
}

/** One provider's conversation loop for one message: returns the answer text. */
export type Converse = (options: ConverseOptions) => Promise<string>;

export type Cooldown = Readonly<Partial<Record<AiModel, Date>>>;

/**
 * Sends the message to the first model with a key that is not cooling down; a used-up quota moves
 * on to the next model, a refused key to the next provider. Any other error stops: the person sees it.
 */
export async function ask(
  options: Omit<ConverseOptions, 'key' | 'model' | 'onRequest' | 'onLimits'> & {
    readonly keys: Readonly<Partial<Record<Provider, string>>>;
    readonly cooldown: Cooldown;
    readonly converse: Readonly<Partial<Record<AiModel, Converse>>>;
    /** The models to try, in order; the free ones when not given. */
    readonly route?: readonly AiModel[];
    readonly onRequest: (model: AiModel) => void;
    readonly onLimits?: (model: AiModel, remaining: number, limit: number) => void;
    /** Each request's token usage, by the model that made it (and its cost, when the provider says). */
    readonly onModelUsage?: (model: AiModel, input: number, output: number, cost?: number) => void;
    /** Called with the pauses as soon as one changes, so they survive any error. */
    readonly onCooldown?: (cooldown: Cooldown) => void;
  },
): Promise<{ reply: string; model: AiModel; cooldown: Cooldown; badKeys: Provider[] }> {
  const now = (options.now ?? (() => new Date()))();
  let cooldown: Cooldown = options.cooldown;
  const badKeys: Provider[] = [];
  let keyError: KeyError | null = null;
  let busy = false;
  const candidates = (options.route ?? ROUTE).filter((m) => options.keys[providerOf(m)] && options.converse[m]);
  if (candidates.length === 0) throw new Error('No AI key is set up.');
  for (const model of candidates) {
    const key = options.keys[providerOf(model)]!;
    if (badKeys.includes(providerOf(model)) || (cooldown[model] && cooldown[model]! > now)) continue;
    let acted = false;
    try {
      const reply = await options.converse[model]!({
        ...options,
        key,
        model,
        onRequest: () => options.onRequest(model),
        onLimits: (remaining, limit) => options.onLimits?.(model, remaining, limit),
        onUsage: (input, output, cost) => options.onModelUsage?.(model, input, output, cost),
        onStep: (tool, ok, text) => {
          if (ok && options.agent.acts.has(tool)) acted = true;
          options.onStep?.(tool, ok, text);
        },
      });
      return { reply, model, cooldown, badKeys };
    } catch (error) {
      if (error instanceof QuotaError) {
        busy ||= error instanceof BusyError;
        cooldown = { ...cooldown, [model]: error.retryAt };
        options.onCooldown?.(cooldown);
        // Part of the request is already on the pedal: another model would do it again ("more gain" twice).
        if (acted) throw error instanceof BusyError ? new BusyError(error.retryAt, { model }) : new QuotaError(error.retryAt, { model });
      } else if (error instanceof KeyError) {
        badKeys.push(error.provider);
        keyError = error;
      } else throw error;
    }
  }
  if (keyError && candidates.every((m) => badKeys.includes(providerOf(m)))) throw keyError;
  const waits = candidates.map((m) => cooldown[m]).filter((d): d is Date => d !== undefined);
  const first = new Date(Math.min(...waits.map((d) => d.getTime())));
  throw busy ? new BusyError(first) : new QuotaError(first);
}
