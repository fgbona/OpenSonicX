# Paid AI providers in the tone assistant — design

## Why

The tone assistant runs on free keys (Groq, Gemini). Their limits are tight (Groq free: 200,000
tokens a day; Gemini Flash free: 20 requests a day) and Gemini's free tier may train on the
conversation. A tone costs a fraction of a cent on a paid model, so many people (the owner first)
would rather pay: better models, no daily wall, no training on their data.

## Goals

- Add paid providers next to the free ones, each with the person's own key, still called straight
  from the browser and the desktop app (no server of ours).
- Let the person choose the order the assistant tries them in; optionally rotate between them.
- Show what each answer cost, estimated.

## Non-goals

- Billing or keys of ours; proxies; accounts.
- Changing the MCP server (it runs inside Claude Code / Claude Desktop already).

## Anti-goals

- A key leaving the person's device for anything but its own provider.
- A different model answering in the middle of a conversation because of rotation (the tone's
  style would jump between "more gain" and "a bit less").
- Breaking the free setup or the 1.x browser data (`groqKey.v1`, `geminiKey.v1` stay as they are).

## Approaches considered

1. **One adapter per provider.** Most code, most to keep in step.
2. **An OpenAI-compatible adapter for every provider that speaks that dialect, plus Claude's own
   and Gemini's existing one.** OpenAI, OpenRouter, xAI (Grok), DeepSeek, Mistral, Cerebras and
   Groq all take OpenAI-style chat completions with tools; only Anthropic and Gemini differ.
3. **OpenRouter only.** One key reaches nearly every model, but forces everyone through one
   reseller.

**Chosen (owner, 2026-11-22): 2**, with OpenRouter as one of the providers.

## Decisions (owner, 2026-11-22)

- Providers: **OpenRouter, Claude (Anthropic), OpenAI, xAI (Grok), DeepSeek**, plus Mistral and
  Cerebras (Claude's call: same adapter, little cost; Cerebras also has a free plan). Groq and
  Gemini keep their free setup; a paid Groq or Gemini key works there unchanged.
- **Order**: one list the person orders (↑↓) with every provider that has a key, free and paid.
  Default for a new paid provider: before the free ones.
- **Rotation is an option**, off by default: "In order" (always the first that is available)
  or "Rotate" (each **new conversation** starts with the next provider; a conversation stays on
  one provider unless it fails or runs out, then the order applies).
- **Cost per answer is shown**: "Answered by Claude Haiku · about US$0.003".

## Checked (2026-11-22)

CORS preflight from `https://fgbona.github.io` and the desktop app's `app://editor` is allowed by
api.openai.com, api.anthropic.com, openrouter.ai, api.x.ai, api.deepseek.com, api.mistral.ai,
api.cerebras.ai and api.groq.com. Anthropic needs the header
`anthropic-dangerous-direct-browser-access: true`.

## Design

- **Provider registry** (`apps/web/lib/providers.ts`, the one place to update): id, name, dialect
  (`openai` | `anthropic`), base URL, key console link, key prefix hint, a preferred-model hint,
  how its model ids map to OpenRouter's catalog (for prices).
- **Models**: read from the provider's own model list with the key (`GET /models`), so new models
  appear without a release; the editor preselects a sensible one by the hint and the person can
  change it. Only models that take tools are offered where the list says so.
- **Adapters**: `openai-compat.ts` (generalises today's `groq.ts`: base URL, model, the answer cap
  field, extra headers; Groq keeps its free-plan waits) and `anthropic.ts` (Messages API tool
  loop). Both keep the existing behaviour: one tool loop per message, quota → next provider,
  busy/timeout → next provider, partial answers never redone elsewhere, model list only in the
  first request, the editor's language.
- **Prices**: OpenRouter's public model catalog (`GET https://openrouter.ai/api/v1/models`, no
  key) gives input/output prices per token; cost = the answer's token usage × those prices.
  OpenRouter answers carry their own cost. Unknown model → no cost shown, never a guess.
- **Storage**: `aiProviders.v1` = `[{ id, key, model }]`, `aiOrder.v1` = provider ids in order,
  `aiRotate.v1` = boolean. Same rules as the free keys: this device only, try/catch, never shown
  back in full, listed in SECURITY.md.
- **Keys screen**: the free section as now; **"+ Add a paid provider"** opens a menu of the
  registry; each added provider shows its key (tested on save), its model selector, a link to
  set a spending limit at the provider, and Remove. Below: the order list with ↑↓ and the
  "Rotate between providers" switch.
- **Meter**: free models keep their request counts; paid ones show today's estimated spend.

## Order of work

1. OpenAI-compatible adapter + registry (OpenRouter, OpenAI, xAI, DeepSeek, Mistral, Cerebras) +
   "Add a paid provider" with key test and model list; paid providers tried before the free ones.
2. Claude adapter.
3. The order list (↑↓) for every provider.
4. Rotation per new conversation (option).
5. Estimated cost per answer and today's spend.

Each step is its own PR, tested with simulated providers; the owner checks each with real keys.

## Left to the builder

Preferred-model hints per provider, layout details, how the model selector filters models
without tool support, the answer cap per provider.
