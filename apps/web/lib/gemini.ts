/**
 * The tone assistant's link to Gemini, called straight from the editor with the person's own key
 * (no server in between). Uses the Interactions API in stateless mode (store: false): the
 * conversation lives in the editor, Google keeps none of it between requests. Tool calls run in the
 * editor through runChatTool, so they act on the pedal the way the person's own edits do.
 */
import { CHAT_INSTRUCTIONS, CHAT_TOOLS, chatContext, runChatTool, type JsonSchema, type ToneHost } from '@pocket-master/core';
import { nextReset, type AiModel } from './aiUsage.ts';

/** Models and their free daily requests (AI Studio, 2026-11). Check aistudio.google.com/rate-limit when they change. */
export const GEMINI_MODELS: Readonly<Record<AiModel, { readonly id: string; readonly freeDailyLimit: number }>> = {
  flash: { id: 'gemini-3.8-flash', freeDailyLimit: 20 },
  lite: { id: 'gemini-3.5-flash-lite', freeDailyLimit: 500 },
};

const API = 'https://generativelanguage.googleapis.com/v1beta';
/** Model requests per message: a tone takes one or two; more means the model is going in circles. */
const MAX_REQUESTS = 6;

/** A step of the conversation, as the Interactions API sends and takes it. */
export type Step = { readonly type: string; readonly [field: string]: unknown };

/** The free quota is used up; Google takes requests again at `retryAt`. */
export class QuotaError extends Error {
  readonly retryAt: Date;
  constructor(retryAt: Date) {
    super('The free Gemini quota is used up for now.');
    this.retryAt = retryAt;
  }
}

/** Google refused the key itself (wrong, deleted, or not allowed for this API). */
export class KeyError extends Error {}

/** JSON Schema in the subset the API documents: unions as anyOf, constants as one-value enums. */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.oneOf) out.anyOf = s.oneOf.map(toGeminiSchema);
  if (Array.isArray(s.type)) out.anyOf = s.type.map((type) => ({ type }));
  else if (s.type) out.type = s.type;
  if (s.const !== undefined) out.enum = [s.const];
  if (s.description) out.description = s.description;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.minimum !== undefined) out.minimum = s.minimum;
  if (s.maximum !== undefined) out.maximum = s.maximum;
  return out;
}

const TOOLS = CHAT_TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) }));

type ApiError = { error?: { status?: string; message?: string; details?: { '@type'?: string; reason?: string; retryDelay?: string }[] } };

/** The error Google answered with, as one of ours. The key is never part of the message. */
function failure(status: number, body: ApiError, now: Date): Error {
  const details = body.error?.details ?? [];
  if (status === 429) {
    const delay = details.find((d) => d['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
    return new QuotaError(Number.isFinite(seconds) ? new Date(now.getTime() + seconds * 1000) : nextReset(now));
  }
  if (status === 401 || status === 403 || details.some((d) => d.reason === 'API_KEY_INVALID')) {
    return new KeyError(body.error?.message ?? 'Google did not accept this key.');
  }
  return new Error(`Gemini answered ${status}${body.error?.message ? `: ${body.error.message}` : ''}`);
}

/** Checks a key with the model list, which costs no generation quota. */
export async function testKey(key: string, fetchFn: typeof fetch = fetch): Promise<'ok' | 'invalid' | 'unavailable'> {
  try {
    const r = await fetchFn(`${API}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
    if (r.ok) return 'ok';
    const body = (await r.json().catch(() => ({}))) as ApiError;
    return failure(r.status, body, new Date()) instanceof KeyError ? 'invalid' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export interface ConverseOptions {
  key: string;
  model: AiModel;
  /** Earlier steps of this conversation (empty for a new one). */
  history: readonly Step[];
  message: string;
  host: ToneHost;
  fetchFn?: typeof fetch;
  /** Called before every request, for the usage meter. */
  onRequest: () => void;
  /** Called after each tool the model ran, with whether it worked. */
  onStep?: (tool: string, ok: boolean, text: string) => void;
  now?: () => Date;
}

/** Sends one message, runs the tools the model asks for, and returns its answer and the history. */
export async function converse(options: ConverseOptions): Promise<{ history: Step[]; reply: string }> {
  const { key, model, host, onRequest, onStep, fetchFn = fetch, now = () => new Date() } = options;
  // The first message carries the preset and the models, so the model needs no lookup calls.
  const content = options.history.length === 0 ? `${chatContext(host)}\n\nRequest: ${options.message}` : options.message;
  const input: Step[] = [...options.history, { type: 'user_input', content }];
  for (let request = 0; request < MAX_REQUESTS; request++) {
    onRequest();
    const r = await fetchFn(`${API}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ model: GEMINI_MODELS[model].id, store: false, system_instruction: CHAT_INSTRUCTIONS, tools: TOOLS, input }),
    });
    const body = (await r.json().catch(() => ({}))) as ApiError & { steps?: Step[] };
    if (!r.ok) throw failure(r.status, body, now());
    const steps = body.steps ?? [];
    input.push(...steps); // model steps go back exactly as received (thoughts included)
    const calls = steps.filter((s) => s.type === 'function_call');
    if (calls.length === 0) {
      const reply = steps.filter((s) => s.type === 'model_output')
        .flatMap((s) => (s.content as { type: string; text?: string }[] | undefined) ?? [])
        .map((c) => c.text ?? '').join('').trim();
      return { history: input, reply };
    }
    for (const c of calls) {
      const result = await runChatTool(host, String(c.name), c.arguments);
      onStep?.(String(c.name), result.ok, result.text);
      input.push({ type: 'function_result', name: c.name, call_id: c.id, is_error: !result.ok, result: [{ type: 'text', text: result.text }] });
    }
  }
  throw new Error('The assistant took too many steps for one message. Try asking again, more simply.');
}
