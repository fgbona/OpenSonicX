/**
 * The tone assistant's link to every provider that takes OpenAI-style chat completions with tools
 * (Groq, OpenAI, OpenRouter, xAI, DeepSeek, Mistral, Cerebras), called straight from the editor with
 * the person's own key. One message runs one tool loop; quotas, overloads and refused keys become
 * the router's errors.
 */
import { CHAT_INSTRUCTIONS, CHAT_TOOLS, runChatTool, type ChatGuard } from '@pocket-master/core';
import { BUSY_WAIT_MS, BusyError, KeyError, MAX_REQUESTS, post, QuotaError, requestTexts, toToolSchema, type ConverseOptions, type Provider } from './assistant.ts';

/** When a 429 does not say how long to wait. */
const DEFAULT_WAIT_MS = 60_000;
/** When a 429 says the daily limit ran out but not when it resets. */
const DAILY_WAIT_MS = 60 * 60_000;

/** Durations such as "2h3m4.5s", "59.56s" or "120ms", in milliseconds; NaN when unreadable. */
export function parseDuration(text: string | null): number {
  const m = text?.trim().match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?$/);
  if (!m || !text?.trim()) return Number.NaN;
  const [, h = '0', min = '0', sec = '0', ms = '0'] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(ms);
}

/** When a 429 lets requests through again: retry-after, else the reset Groq states, else a guess. */
function retryAt(r: Response, message: string | undefined, now: Date): Date {
  const seconds = Number(r.headers.get('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) return new Date(now.getTime() + seconds * 1000);
  const reset = parseDuration(r.headers.get('x-ratelimit-reset-requests'));
  if (Number.isFinite(reset) && reset > 0) return new Date(now.getTime() + reset);
  return new Date(now.getTime() + (/per day|RPD/i.test(message ?? '') ? DAILY_WAIT_MS : DEFAULT_WAIT_MS));
}

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const TOOLS = CHAT_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toToolSchema(t.parameters) } }));

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

/**
 * The key's model ids, which also checks the key: the model list costs no request quota.
 * 'invalid' when the provider refused the key (401/403), 'unavailable' when it could not answer.
 */
export async function listModels(api: string, key: string, fetchFn: typeof fetch = fetch): Promise<readonly string[] | 'invalid' | 'unavailable'> {
  try {
    const r = await fetchFn(`${api}/models`, { headers: auth(key) });
    if (r.status === 401 || r.status === 403) return 'invalid';
    if (!r.ok) return 'unavailable';
    const body = (await r.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return 'unavailable';
  }
}

/** A provider that takes OpenAI-style chat completions with tools, and the model to use there. */
export interface ChatEndpoint {
  readonly provider: Provider;
  /** Shown in errors: "OpenAI answered 400". */
  readonly name: string;
  /** Base URL, without the trailing /chat/completions. */
  readonly api: string;
  readonly model: string;
  /** The longest answer a request allows, in the field the provider reads. */
  readonly cap?: { readonly field: 'max_completion_tokens' | 'max_tokens'; readonly tokens: number };
  /** A 429 that frees up within this many ms is waited out inside the message (Groq's free plan). */
  readonly shortWaitMs?: number;
  /** A 400 with this error code means a malformed tool call; it is asked once more. */
  readonly retryCode?: string;
}

/** Sends one message to an OpenAI-style provider, runs the tools it asks for, and returns its answer. */
export async function converseChat(endpoint: ChatEndpoint, options: ConverseOptions): Promise<string> {
  const { key, host, onRequest, onStep, onLimits, fetchFn = fetch, now = () => new Date(), wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = options;
  const messages: Message[] = [
    { role: 'system', content: CHAT_INSTRUCTIONS },
    ...options.turns.map((t): Message => ({ role: t.role, content: t.text })),
  ];
  const text = requestTexts(host, options.turns, options.message, options.language);
  const asked = messages.push({ role: 'user', content: text.first }) - 1;
  const guard: ChatGuard = { index: host.snapshot().index };
  let retriedToolCall = false;
  let waited = 0;
  for (let request = 0; request < MAX_REQUESTS; request++) {
    onRequest();
    const r = await post(fetchFn, `${endpoint.api}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(key) },
      body: JSON.stringify({ model: endpoint.model, messages, tools: TOOLS, ...(endpoint.cap ? { [endpoint.cap.field]: endpoint.cap.tokens } : {}) }),
    }, now);
    // Readable only if the provider exposes them to the browser; otherwise the meter counts on its own.
    const remaining = Number(r.headers.get('x-ratelimit-remaining-requests') ?? Number.NaN);
    const limit = Number(r.headers.get('x-ratelimit-limit-requests') ?? Number.NaN);
    if (Number.isFinite(remaining) && Number.isFinite(limit)) onLimits?.(remaining, limit);
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: string }; choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
    if (r.status === 429) {
      const at = retryAt(r, body.error?.message, now());
      const ms = at.getTime() - now().getTime();
      // Groq's free tokens-a-minute fill up on a tone's second request: wait a few seconds, same request.
      if (ms <= (endpoint.shortWaitMs ?? 0) && waited < 2) {
        waited += 1;
        await wait(ms);
        request -= 1;
        continue;
      }
      throw new QuotaError(at);
    }
    if (r.status === 503 || r.status === 498) throw new BusyError(new Date(now().getTime() + BUSY_WAIT_MS));
    // 403 is not a wrong key (that is 401): a blocked model or network, so the provider's reason is shown as is.
    if (r.status === 401) throw new KeyError(endpoint.provider, body.error?.message ?? `${endpoint.name} did not accept this key.`);
    // gpt-oss now and then writes a tool call Groq cannot parse; asking again usually works.
    if (r.status === 400 && endpoint.retryCode && body.error?.code === endpoint.retryCode && !retriedToolCall) {
      retriedToolCall = true;
      continue;
    }
    if (!r.ok) throw new Error(`${endpoint.name} answered ${r.status}${body.error?.message ? `: ${body.error.message}` : ''}`);
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error(`${endpoint.name} sent no answer this editor understands. Try again in a moment.`);
    messages[asked] = { role: 'user', content: text.later }; // answered once: the model list is not sent again
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return (message.content ?? '').trim();
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const c of calls) {
      let args: unknown = null;
      try {
        args = JSON.parse(c.function.arguments);
      } catch {
        // left null: the tool answers with what was wrong
      }
      const result = await runChatTool(host, c.function.name, args, guard);
      onStep?.(c.function.name, result.ok, result.text);
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: result.text });
    }
  }
  throw new Error('The assistant took too many steps for one message. Try asking again, more simply.');
}
