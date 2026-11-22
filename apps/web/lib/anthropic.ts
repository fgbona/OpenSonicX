/**
 * The tone assistant's link to Claude (Anthropic Messages API), called straight from the editor
 * with the person's own paid key. The browser header is what Anthropic asks of calls made from a
 * page; the key goes only in x-api-key.
 */
import { CHAT_INSTRUCTIONS, CHAT_TOOLS, runChatTool, type ChatGuard } from '@pocket-master/core';
import { BUSY_WAIT_MS, BusyError, KeyError, MAX_REQUESTS, post, QuotaError, requestTexts, toToolSchema, type ConverseOptions } from './assistant.ts';

const API = 'https://api.anthropic.com/v1';
/** A tone's edit list and a few sentences fit well within this. */
const MAX_TOKENS = 4096;
/** When a 429 does not say how long to wait. */
const DEFAULT_WAIT_MS = 60_000;

const headers = (key: string) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Message = { role: 'user' | 'assistant'; content: string | Block[] };
type ApiError = { error?: { type?: string; message?: string } };

const TOOLS = CHAT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: toToolSchema(t.parameters) }));

/** The key's model ids, which also checks the key; 'invalid' when refused, 'unavailable' when it could not answer. */
export async function listClaudeModels(key: string, fetchFn: typeof fetch = fetch): Promise<readonly string[] | 'invalid' | 'unavailable'> {
  try {
    const r = await fetchFn(`${API}/models`, { headers: headers(key) });
    if (r.status === 401 || r.status === 403) return 'invalid';
    if (!r.ok) return 'unavailable';
    const body = (await r.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return 'unavailable';
  }
}

/** Sends one message to Claude, runs the tools it asks for, and returns its answer. */
export async function converseClaude(model: string, options: ConverseOptions): Promise<string> {
  const { key, host, onRequest, onStep, fetchFn = fetch, now = () => new Date() } = options;
  const messages: Message[] = options.turns.map((t) => ({ role: t.role, content: t.text }));
  const text = requestTexts(host, options.turns, options.message, options.language);
  const asked = messages.push({ role: 'user', content: text.first }) - 1;
  const guard: ChatGuard = { index: host.snapshot().index };
  for (let request = 0; request < MAX_REQUESTS; request++) {
    onRequest();
    const r = await post(fetchFn, `${API}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers(key) },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: CHAT_INSTRUCTIONS, tools: TOOLS, messages }),
    }, now);
    const body = (await r.json().catch(() => ({}))) as ApiError & { content?: Block[] };
    if (r.status === 429) {
      const seconds = Number(r.headers.get('retry-after'));
      throw new QuotaError(new Date(now().getTime() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_WAIT_MS)));
    }
    if (r.status === 529 || r.status === 503) throw new BusyError(new Date(now().getTime() + BUSY_WAIT_MS));
    if (r.status === 401) throw new KeyError('anthropic', body.error?.message ?? 'Claude did not accept this key.');
    if (!r.ok) throw new Error(`Claude answered ${r.status}${body.error?.message ? `: ${body.error.message}` : ''}`);
    const content = body.content;
    if (!Array.isArray(content)) throw new Error('Claude sent no answer this editor understands. Try again in a moment.');
    messages[asked] = { role: 'user', content: text.later }; // answered once: the model list is not sent again
    const calls = content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (calls.length === 0) return content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
    messages.push({ role: 'assistant', content });
    const results: Block[] = [];
    for (const c of calls) {
      const result = await runChatTool(host, c.name, c.input, guard);
      onStep?.(c.name, result.ok, result.text);
      results.push({ type: 'tool_result', tool_use_id: c.id, content: result.text, ...(result.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('The assistant took too many steps for one message. Try asking again, more simply.');
}
