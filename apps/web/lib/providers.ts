/**
 * The paid providers the tone assistant can use with the person's own key: all take OpenAI-style
 * chat completions with tools (openai-compat.ts). The one place to add or update one. Models come
 * from the key's own model list, so new ones appear without a release; `prefer` picks a sensible
 * default (good with tools, inexpensive), which the person can change.
 */
import type { PaidId } from './assistant.ts';

export interface PaidProvider {
  readonly id: PaidId;
  readonly name: string;
  /** Base URL of the OpenAI-style API. */
  readonly api: string;
  /** Where the person creates a key. */
  readonly keys: string;
  /** Where the person sets a spending limit. */
  readonly limits: string;
  readonly placeholder: string;
  /** Default model, first match wins; otherwise the first chat model. */
  readonly prefer: readonly RegExp[];
}

export const PAID: readonly PaidProvider[] = [
  {
    id: 'openrouter', name: 'OpenRouter', api: 'https://openrouter.ai/api/v1', keys: 'https://openrouter.ai/settings/keys',
    limits: 'https://openrouter.ai/settings/keys', placeholder: 'sk-or-…',
    prefer: [/^anthropic\/claude-.*haiku/, /^openai\/gpt-[\d.]+-mini$/, /^google\/gemini-[\d.]+-flash$/],
  },
  {
    id: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1', keys: 'https://platform.openai.com/api-keys',
    limits: 'https://platform.openai.com/settings/organization/limits', placeholder: 'sk-…',
    prefer: [/^gpt-[\d.]+-mini$/, /^gpt-[\d.]+$/],
  },
  {
    id: 'xai', name: 'xAI (Grok)', api: 'https://api.x.ai/v1', keys: 'https://console.x.ai', limits: 'https://console.x.ai',
    placeholder: 'xai-…', prefer: [/^grok-[\d.]+-fast/, /^grok-[\d.]+-mini/, /^grok-[\d.]+$/],
  },
  {
    id: 'deepseek', name: 'DeepSeek', api: 'https://api.deepseek.com', keys: 'https://platform.deepseek.com/api_keys',
    limits: 'https://platform.deepseek.com/usage', placeholder: 'sk-…', prefer: [/^deepseek-chat$/],
  },
  {
    id: 'mistral', name: 'Mistral', api: 'https://api.mistral.ai/v1', keys: 'https://console.mistral.ai/api-keys',
    limits: 'https://console.mistral.ai/usage', placeholder: '…', prefer: [/^mistral-medium-latest$/, /^mistral-small-latest$/, /^mistral-large-latest$/],
  },
  {
    id: 'cerebras', name: 'Cerebras', api: 'https://api.cerebras.ai/v1', keys: 'https://cloud.cerebras.ai', limits: 'https://cloud.cerebras.ai',
    placeholder: 'csk-…', prefer: [/gpt-oss-120b/, /llama/],
  },
];

export const paidById = (id: string): PaidProvider | undefined => PAID.find((p) => p.id === id);

/** Models that are not for chat: embeddings, speech, images, moderation, search and the like. */
const NOT_CHAT = /embed|tts|whisper|dall-e|image|audio|moderation|realtime|transcribe|search|guard|rerank|speech|ocr/i;

/** The chat models of a key's model list, sorted. */
export function chatModels(ids: readonly string[]): string[] {
  return ids.filter((id) => !NOT_CHAT.test(id)).sort();
}

/** The model preselected for a provider: the first preferred one the key has, else the first chat model. */
export function pickModel(provider: PaidProvider, ids: readonly string[]): string | null {
  const chat = chatModels(ids);
  for (const pattern of provider.prefer) {
    const found = chat.find((id) => pattern.test(id));
    if (found) return found;
  }
  return chat[0] ?? null;
}
