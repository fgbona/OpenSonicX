# Tone assistant in the editor — design

## Why

Most people who buy a pedal like this do not know how to build a tone: which amp model is "the
Black Album", where to set gain, which cab. The MCP server already lets an AI assistant do that
from Claude Code or Claude Desktop, but only for people who run those. The owner wants it inside
the editor, the way TONE3000 is: type "black album base no 45" and the pedal gets the tone. That
is the feature that sets a simple pedal apart.

## Goals

- A person with no technical background can get a tone by describing it, inside the editor (web
  and desktop app).
- No cost for the owner, and none for the person: Gemini's free API key.
- The pedal stays safe: the assistant only changes the live sound; storing to a slot always needs
  the person's click in the editor.

## Non-goals

- The owner paying for AI ("AI included", with accounts and quotas). Possible later on the same
  pieces; not now.
- Uploading IRs, NAM captures or TONE3000 tones from the chat. Those stay in their own panels.
- Using a consumer subscription (claude.ai, ChatGPT, Gemini app) from a chat inside the editor:
  no provider allows a third-party app to use one (Anthropic forbids it in its terms; Google has
  no such flow). Subscriptions work only when the conversation happens in their app (mode B).

## Anti-goals

- A key or a session address that lets someone else drive a stranger's pedal or spend their quota.
- The assistant overwriting a slot on its own.
- Two copies of the tool logic (MCP and editor) drifting apart.

## Approaches considered

1. **Chat in the editor, the person's own key** — the editor calls the provider from the browser;
   the tools run in the editor against the pedal. No server. Needs a key (free for Gemini).
2. **Bridge through the owner's server** — the conversation happens in claude.ai or ChatGPT; a
   relay on the owner's server exposes an MCP endpoint per editor session and forwards tool calls
   to the open editor tab. Uses the person's subscription, no key. Needs a server and care.
3. **The owner's key behind the owner's server** — rejected for now: cost grows with use and needs
   accounts, quotas and privacy work.

**Chosen (owner, 2026-11-21): 1 now, with Gemini's free key.** Mode A = chat in the editor. Mode B
(bridge for Claude / ChatGPT subscriptions) is kept as the next step, on the same base, but is not
part of this work.

## The shared base

The tone tools move from `apps/mcp/src/session.ts` into `packages/core/src/assistant/`, working
on a small IO (`Pedal` + slot names + modified flag), so the MCP server, the editor chat and the
bridge run the same code:

| Tool | In the chat / bridge | Notes |
|---|---|---|
| `get_preset` | yes | the loaded preset, chain, values, unsaved flag |
| `list_models` | yes | models with what they are based on |
| `edit_preset` | yes | same change list and checks as today |
| `undo_edit` | yes | added in #110 |
| `revert_preset` | yes | |
| `list_presets` | yes | names of the 100 slots |
| `select_preset` | yes, asks first | loading another preset discards unsaved edits: the editor's own "Discard the changes?" dialog |
| `save_preset` | **proposal only** | the assistant proposes slot and name; the editor shows its Save dialog filled in; nothing is written until the person clicks |

File, IR, NAM, TONE3000 and global-settings tools stay MCP-only. Tool names, parameters and
descriptions are defined once in core as JSON Schema; the MCP server keeps registering its zod
shapes, and a test checks that both match the frozen contract (`apps/mcp/test/fixtures/
tool-contract.json`).

**Fewer requests per tone.** The Gemini free tier allows about 20 requests a day on Flash. The
editor sends, with the first message of a conversation, the current preset and the compact model
list, so a tone needs one or two model turns (edit, then answer) instead of three to five.

**How the tools reach the pedal (builder's question, settled by Claude).** Core holds the tool
definitions, the argument resolution (block, model and parameter names to edits, with the same
checks and errors as today) and the text the model gets back. Execution goes through an interface
each surface implements: in the MCP server, straight to the pedal as now (its own 20-step undo);
in the editor, through the editor's state (`usePocketMaster`): edits go through the same path as a
knob turn, so the screen, the busy lock and the editor's Undo/Redo history stay the one source of
truth, and `undo_edit` in the chat is the editor's Undo. One history, not two.

**Chat and MCP tool sets (settled by Claude).** Shared tools have the same name, parameters and
description on both surfaces. Where a surface differs it has its own definition: in the chat,
`save_preset` takes slot and name only (no `confirm`, no `backup`: the Save dialog does that) and
`select_preset` triggers the editor's own confirmation. The MCP server's tools, descriptions and
instructions stay byte for byte as they are in step 1; the contract test keeps checking them.

## Mode A — chat in the editor

- **Panel** "Assistente de timbre" next to TONE3000: a message box, the conversation, and each
  change the assistant made listed under its message (the pedal and the screen update live).
- **Provider:** Gemini (free key), behind a small adapter interface so Claude or OpenAI can be added later without touching the panel.
  Each adapter turns the shared tool schemas into the provider's function-calling format and runs
  the loop: send, run the tool calls in the editor, send results, until a text answer.
- **Getting a Gemini key, guided:** a button opens `https://aistudio.google.com/apikey` (Google
  handles sign-in); short illustrated steps: *Create API key*, copy, paste here. The editor tests
  the key at once ("Key works") before saving it.
- **Key storage:** this browser or app only (localStorage), never sent anywhere but the provider;
  a *Remove key* button; the key is never shown back in full.
- **Usage meter:** the API reports no remaining quota, so the editor counts its own requests per
  Pacific day and shows "8 of 20 used today · resets at 05:00" (limit configurable, default from
  the model; local time of the reset). On a 429 it shows "Quota used up · resets at …" with the
  retry delay Google returns, and offers the Flash-Lite model (about 500 a day, weaker). A link
  opens AI Studio's rate-limit page for exact numbers. The meter is an estimate when the key is
  also used elsewhere; the panel says so.
- **When the chat works (settled by Claude):** the panel shows only while the pedal is connected,
  like TONE3000. Questions that change nothing (what amp is on the Black Album?) are answered
  with Live edit off; the first change asks to turn Live edit on.
- **Privacy notice (settled by Claude):** the panel says, before the key is saved and in small
  text under the chat, that the conversation and the current preset go to Google, and that on
  the free tier Google may use them to improve its products (Gemini API terms). If Google refuses
  the free tier in the person's region, its error is shown as is, with a link to its availability
  page.
- **Safety:** live edits need Live edit on (the panel turns it on with the person's OK); undo and
  Revert work on the assistant's changes; saving is the editor's Save dialog.

## Later: mode B — bridge for Claude / ChatGPT subscriptions (not in this work)

- **Relay** (`apps/relay`, Docker, on the owner's server, behind Caddy with Let's Encrypt):
  - the editor opens a WebSocket to the relay and gets a session with a long random secret;
  - the relay serves MCP (Streamable HTTP) at `https://<domain>/mcp/<secret>`; each tool call is
    forwarded to that session's editor tab, which runs it on the pedal and answers;
  - the session ends when the tab closes or after inactivity; the address then stops working.
- **In the editor:** *Usar com Claude / ChatGPT* shows the session address with a copy button and
  the steps to add it as a connector in claude.ai or ChatGPT; a status line shows when the AI is
  connected and what it just changed.
- **Security:** HTTPS only; the secret is the only credential, scoped to one live tab, unguessable,
  never logged; rate limit per session; the relay stores nothing (no presets, no conversations);
  save is a proposal confirmed in the editor, as in mode A; the container runs hardened like the
  editor's (non-root, read-only filesystem). No accounts or passwords. If a connector later
  requires OAuth, the relay implements the MCP authorization flow with the session as the grant,
  still without storing passwords.
- **Privacy:** a short page stating what the relay sees (tool calls and results in transit) and
  keeps (nothing).

## Order of work

1. Base: tools in core, MCP server on them (no behaviour change, contract test unchanged).
2. Mode A with Gemini: panel, guided key, adapter, usage meter, save proposal; e2e with the
   simulated pedal and a simulated model. Checked by the owner with a real free key.

Each step is its own PR. Afterwards, on request: Claude and OpenAI adapters for mode A, then mode B.

## Constraints

- Static site and desktop app stay as they are: no server.
- No new server-side state beyond live sessions. Keys never leave the person's device except to
  the provider.
- Chat text in the editor's language; tool definitions and system instructions in English.
- Gemini's free tier changes often (2026: about 20 requests a day on Flash, about 500 on Flash-Lite,
  reset at midnight Pacific, per project). Read the model ids and limits when building; keep them
  in one place so they are easy to update.

## Left to the builder

Panel layout details, message rendering, adapter internals, the relay's framework, session
timeouts within "minutes of inactivity", and the exact Flash / Flash-Lite model ids (read from
Google's model list when building).
