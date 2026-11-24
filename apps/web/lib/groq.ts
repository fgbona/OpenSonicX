/**
 * The tone assistant's link to Groq (OpenAI-compatible chat completions), called straight from the
 * editor with the person's own free key. Groq's free plan gives about 1,000 requests a day per model.
 */
import type { ConverseOptions } from './assistant.ts';
import { converseChat, listModels, parseDuration, type ChatEndpoint } from './openai-compat.ts';

/**
 * The model and its free daily requests (console.groq.com, 2026-11); it calls tools one at a time.
 * The free plan also allows 8,000 tokens a minute, counting the longest answer a request allows,
 * so the answer is capped: a tone's edit list and reasoning fit in it.
 */
export const GROQ_MODEL = { id: 'openai/gpt-oss-120b', freeDailyLimit: 1000, maxCompletionTokens: 2500 } as const;

const ENDPOINT: ChatEndpoint = {
  provider: 'groq',
  name: 'Groq',
  api: 'https://api.groq.com/openai/v1',
  model: GROQ_MODEL.id,
  cap: { field: 'max_completion_tokens', tokens: GROQ_MODEL.maxCompletionTokens },
  // A per-minute limit shorter than this is waited out inside the message instead of handed on.
  shortWaitMs: 90_000,
  retryCode: 'tool_use_failed',
};

/** Groq durations such as "2h3m4.5s", "59.56s" or "120ms", in milliseconds; NaN when unreadable. */
export const parseGroqDuration = parseDuration;

/** Checks a key with the model list, which uses no request quota. */
export async function testGroqKey(key: string, fetchFn: typeof fetch = fetch): Promise<'ok' | 'invalid' | 'unavailable'> {
  const models = await listModels(ENDPOINT.api, key, fetchFn);
  return typeof models === 'string' ? models : 'ok';
}

/** Sends one message to Groq, runs the tools it asks for, and returns its answer. */
export const converseGroq = (options: ConverseOptions): Promise<string> => converseChat(ENDPOINT, options);
