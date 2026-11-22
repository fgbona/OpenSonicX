/**
 * The tone assistant's link to Groq (OpenAI-compatible chat completions), called straight from the
 * editor with the person's own free key. Groq's free plan gives about 1,000 requests a day per model.
 */
import { CHAT_INSTRUCTIONS, CHAT_TOOLS, runChatTool, type ChatGuard } from '@pocket-master/core';
import { BUSY_WAIT_MS, BusyError, KeyError, MAX_REQUESTS, post, QuotaError, requestText, toToolSchema, type ConverseOptions } from './assistant.ts';

/**
 * The model and its free daily requests (console.groq.com, 2026-11); it calls tools one at a time.
 * The free plan also allows 8,000 tokens a minute, counting the longest answer a request allows,
 * so the answer is capped: a tone's edit list and reasoning fit in it.
 */
export const GROQ_MODEL = { id: 'openai/gpt-oss-120b', freeDailyLimit: 1000, maxCompletionTokens: 2500 } as const;
/** A per-minute limit shorter than this is waited out inside the message instead of handed on. */
const SHORT_WAIT_MS = 45_000;

const API = 'https://api.groq.com/openai/v1';
/** When a 429 does not say how long to wait. */
const DEFAULT_WAIT_MS = 60_000;
/** When a 429 says the daily limit ran out but not when it resets. */
const DAILY_WAIT_MS = 60 * 60_000;

/** Groq durations such as "2h3m4.5s", "59.56s" or "120ms", in milliseconds; NaN when unreadable. */
export function parseGroqDuration(text: string | null): number {
  const m = text?.trim().match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?$/);
  if (!m || !text?.trim()) return Number.NaN;
  const [, h = '0', min = '0', sec = '0', ms = '0'] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(ms);
}

/** When a 429 lets requests through again: retry-after, else the reset Groq states, else a guess. */
function retryAt(r: Response, message: string | undefined, now: Date): Date {
  const seconds = Number(r.headers.get('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) return new Date(now.getTime() + seconds * 1000);
  const reset = parseGroqDuration(r.headers.get('x-ratelimit-reset-requests'));
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

/** Checks a key with the model list, which uses no request quota. */
export async function testGroqKey(key: string, fetchFn: typeof fetch = fetch): Promise<'ok' | 'invalid' | 'unavailable'> {
  try {
    const r = await fetchFn(`${API}/models`, { headers: auth(key) });
    if (r.ok) return 'ok';
    return r.status === 401 || r.status === 403 ? 'invalid' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Sends one message to Groq, runs the tools it asks for, and returns its answer. */
export async function converseGroq(options: ConverseOptions): Promise<string> {
  const { key, host, onRequest, onStep, onLimits, fetchFn = fetch, now = () => new Date(), wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = options;
  const messages: Message[] = [
    { role: 'system', content: CHAT_INSTRUCTIONS },
    ...options.turns.map((t): Message => ({ role: t.role, content: t.text })),
    { role: 'user', content: requestText(host, options.turns, options.message, options.language) },
  ];
  const guard: ChatGuard = { index: host.snapshot().index };
  let retriedToolCall = false;
  let waited = 0;
  for (let request = 0; request < MAX_REQUESTS; request++) {
    onRequest();
    const r = await post(fetchFn, `${API}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(key) },
      body: JSON.stringify({ model: GROQ_MODEL.id, messages, tools: TOOLS, max_completion_tokens: GROQ_MODEL.maxCompletionTokens }),
    }, now);
    // Readable only if Groq exposes them to the browser; otherwise the meter counts on its own.
    const remaining = Number(r.headers.get('x-ratelimit-remaining-requests') ?? Number.NaN);
    const limit = Number(r.headers.get('x-ratelimit-limit-requests') ?? Number.NaN);
    if (Number.isFinite(remaining) && Number.isFinite(limit)) onLimits?.(remaining, limit);
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: string }; choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
    if (r.status === 429) {
      const at = retryAt(r, body.error?.message, now());
      const ms = at.getTime() - now().getTime();
      // The free plan's tokens-a-minute fill up on a tone's second request: wait a few seconds, same request.
      if (ms <= SHORT_WAIT_MS && waited < 2) {
        waited += 1;
        await wait(ms);
        request -= 1;
        continue;
      }
      throw new QuotaError(at);
    }
    if (r.status === 503 || r.status === 498) throw new BusyError(new Date(now().getTime() + BUSY_WAIT_MS));
    // 403 is not a wrong key (that is 401): a blocked model or network, so Groq's reason is shown as is.
    if (r.status === 401) throw new KeyError('groq', body.error?.message ?? 'Groq did not accept this key.');
    // gpt-oss now and then writes a tool call Groq cannot parse; asking again usually works.
    if (r.status === 400 && body.error?.code === 'tool_use_failed' && !retriedToolCall) {
      retriedToolCall = true;
      continue;
    }
    if (!r.ok) throw new Error(`Groq answered ${r.status}${body.error?.message ? `: ${body.error.message}` : ''}`);
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('Groq sent no answer this editor understands. Try again in a moment.');
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
