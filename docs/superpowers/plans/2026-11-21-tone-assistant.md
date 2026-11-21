# Tone Assistant Implementation Plan

**Goal:** A chat panel in the editor that builds tones on the pedal from a description, using the
person's free Gemini API key, with the tone tools shared between the MCP server and the editor.

**Architecture:** The tool logic the MCP server has (change resolution, preset and model text)
moves into `packages/core/src/assistant/`. Core also defines the chat tool set and runs a chat
tool against a `ToneHost` interface; the editor implements `ToneHost` on its own state
(`usePocketMaster`), so edits, Undo/Redo, the busy lock and the Save and Discard dialogs are the
editor's own. A Gemini adapter in `apps/web` runs the function-calling loop from the browser.

**Tech Stack:** TypeScript, node:test, React 19 / Next.js 16 (static export), Playwright, Gemini
REST API (`generativelanguage.googleapis.com`, `generateContent` with `tools.functionDeclarations`).

**Spec:** `docs/superpowers/specs/2026-11-21-ai-assistant-design.md`

## Global Constraints

- No server: the editor calls Gemini directly; the key stays in localStorage on the device.
- MCP server tools, descriptions and instructions stay byte for byte; `apps/mcp/test/fixtures/
  tool-contract.json` and the MCP session tests pass unchanged.
- The assistant never writes a slot: `save_preset` in the chat opens the editor's Save dialog
  filled in; `select_preset` goes through the editor's Discard confirmation.
- Chat UI text in en and pt (`apps/web/lib/messages.ts`); tool definitions and instructions in English.
- Gemini model ids and free-tier limits live in one constant (`apps/web/lib/gemini.ts`).
- Changelog entry per PR; conventional commits; no attribution lines.

## Review Focus

1. A model that calls tools in a loop forever, or answers with an unknown tool: the loop stops
   after 6 model turns with a readable message; unknown tools return an error result, not a throw.
2. A 429 / invalid key / network failure mid-conversation: the panel shows it (quota: reset time
   and Flash-Lite offer), keeps the conversation, sends nothing to the pedal.
3. The person turns a knob or loads another preset while the assistant works: tool calls read
   the editor's state at call time; a preset change between turns makes edit tools refuse with
   "the preset changed".
4. Live edit off when the model edits: the host asks to turn it on; refusing returns an error
   result the model can relay.
5. The key never appears in logs, errors or the SysEx log, and is sent only to Google.

---

### Task 1: Move the tone helpers into core (PR 1)

**Files:**
- Create: `packages/core/src/assistant/change.ts` (`Change` type, `toEdit`, `typedValue`)
- Create: `packages/core/src/assistant/format.ts` (`formatPreset`, `formatModels`, `formatParamSpec`)
- Modify: `packages/core/src/index.ts`, `apps/mcp/src/session.ts` (import them, delete the local copies)
- Test: `packages/core/test/assistant-change.test.ts`, `packages/core/test/assistant-format.test.ts`

**Interfaces:**
- Produces: `type Change` (same union as `apps/mcp/src/session.ts:53` today);
  `toEdit(preset: Preset, change: Change, slots: SlotNames): Edit`;
  `formatPreset(index: number, name: string, preset: Preset, slots: SlotNames, modified: boolean | null): string`;
  `formatModels(blockKey: string, label: string, slots: SlotNames): string`.

- [ ] **Step 1:** Write the core tests by moving the cases that exercise these helpers' behaviour
  (parameter by name, switch "on"/"off", select option by name, move position range error, model
  by profile name, preset text with "unsaved changes: unknown") to the new test files, calling
  the helpers directly with `decodePreset(realP08())` and slot names `{ irNames: ['Mesa OS', …], profileNames: ['Randall SA', …] }`.
- [ ] **Step 2:** Run `node --test packages/core/test/assistant-*.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3:** Move the code (no behaviour change), export from `index.ts`, import in `session.ts`.
- [ ] **Step 4:** Run `SKIP_CLO_PARITY=1 npm test && npm run typecheck` — Expected: all pass, MCP session and contract tests unchanged.
- [ ] **Step 5:** Commit `refactor(core): tone helpers shared by the MCP server and the editor`.

### Task 2: Chat tool set and runner in core (PR 1)

**Files:**
- Create: `packages/core/src/assistant/chat.ts`
- Test: `packages/core/test/assistant-chat.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  ```ts
  interface ToneHost {
    snapshot(): { index: number; name: string; preset: Preset; slots: SlotNames; modified: boolean | null; names: readonly string[] };
    applyEdits(edits: readonly Edit[]): Promise<void>;  // throws a readable Error when refused
    undo(): Promise<boolean>;                           // false: nothing to undo
    revert(): Promise<void>;
    selectPreset(index: number): Promise<boolean>;      // false: the person kept the current one
    proposeSave(index: number, name: string): Promise<'saved' | 'cancelled'>;
  }
  const CHAT_TOOLS: readonly { name: string; description: string; parameters: JsonSchema }[];
  const CHAT_INSTRUCTIONS: string;
  function chatContext(host: ToneHost): string;   // preset text + compact model list for the first message
  function runChatTool(host: ToneHost, name: string, args: unknown): Promise<{ ok: boolean; text: string }>;
  ```
- Chat tools: `get_preset`, `list_models` (optional `block`), `edit_preset` (`changes`, same
  shape as the MCP contract's `edit_preset`), `undo_edit`, `revert_preset`, `list_presets`,
  `select_preset` (`preset` label), `save_preset` (`slot`, `name` only).
- `CHAT_INSTRUCTIONS`: the MCP server's tone guidance (`apps/mcp/src/tools.ts:59-66`) minus file
  tools, plus: "the editor shows every change live; saving opens a dialog the person confirms";
  "answer in the language the person writes in".

- [ ] **Step 1: Failing tests** with a fake host (records calls, holds a decoded P08):
  - `runChatTool(host, 'edit_preset', { changes: [{ kind: 'parameter', block: 'amp', parameter: 'gain', value: 70 }] })` → `ok: true`, host got one `param` edit, text contains `Gain 70`.
  - a bad change list → `ok: false`, `host.applyEdits` never called (all-or-nothing, as MCP).
  - `save_preset { slot: 'P45', name: 'BLACK ALB' }` → `host.proposeSave(44, 'BLACK ALB')`; `'cancelled'` → text says the person did not save.
  - `select_preset` declined → `ok: false`, text "kept the current preset".
  - unknown tool / malformed args → `ok: false`, readable text, no throw.
  - every `CHAT_TOOLS` entry shared with MCP (`get_preset`, `list_models`, `edit_preset`, `undo_edit`, `revert_preset`, `list_presets`, `select_preset`) has the same parameter shape as `apps/mcp/test/fixtures/tool-contract.json` (render with the same `shape()` helper; move it to a test util).
- [ ] **Step 2:** Run the test — Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `chat.ts`; arguments are validated by hand against the schema (no new dependency).
- [ ] **Step 4:** `SKIP_CLO_PARITY=1 npm test && npm run typecheck` — Expected: pass.
- [ ] **Step 5:** Commit `feat(core): chat tool set and runner for the tone assistant`; CHANGELOG; PR 1.

### Task 3: Key store and usage meter (PR 2)

**Files:** Create `apps/web/lib/aiKey.ts`, `apps/web/lib/aiUsage.ts`; Test `apps/web/test/ai-usage.test.ts`

**Interfaces:**
- `aiKey.ts`: `loadKey(): string | null`, `saveKey(key: string)`, `removeKey()` (localStorage
  `pocket-master-editor.geminiKey.v1`, try/catch like `slotNotes.ts`); `maskKey(key)` → `AIza…f3Q`.
- `aiUsage.ts` (pure + a `useAiUsage` store like `slotNotes.ts`):
  `pacificDay(now: Date): string` (YYYY-MM-DD in America/Los_Angeles via `Intl.DateTimeFormat`);
  `nextReset(now: Date): Date` (next Pacific midnight); `countRequest(state, model, now)`;
  `usedToday(state, model, now): number`.
- [ ] **Step 1: Failing tests:** day boundary at Pacific midnight (2026-11-22T07:59Z is the 21st,
  08:00Z the 22nd, PST); `nextReset` from 2026-11-21T20:00Z is 2026-11-22T08:00Z; counts reset on
  a new day; separate counts per model; a stored value from an older day reads as 0.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS. **Step 5:** Commit.

### Task 4: Gemini adapter (PR 2)

**Files:** Create `apps/web/lib/gemini.ts`; Test `apps/web/test/gemini.test.ts`

**Interfaces:**
- `GEMINI_MODELS = { flash: { id, freeDailyLimit: 20 }, lite: { id, freeDailyLimit: 500 } }` (ids
  from Google's model list when building).
- `testKey(key, fetchFn = fetch): Promise<'ok' | 'invalid' | 'unavailable'>` (one `models.list`).
- `converse(options: { key; model: 'flash' | 'lite'; history: Turn[]; message: string; host: ToneHost; fetchFn?; onRequest(); onStep(text) }): Promise<{ history: Turn[]; reply: string }>`;
  throws `QuotaError { retryAt: Date }` on 429 (from the `RetryInfo` detail, else `nextReset`),
  `KeyError` on 400/403 with API_KEY_INVALID.
- The first turn of a conversation is prefixed with `chatContext(host)`; tools from `CHAT_TOOLS`
  as `functionDeclarations`; system text `CHAT_INSTRUCTIONS`; key in the `x-goog-api-key` header
  (never in the URL).
- [ ] **Step 1: Failing tests** with a scripted `fetchFn`: a function call then text → host edit
  applied, reply returned, `onRequest` called twice; 6 straight function-call turns → stops with
  "took too many steps"; 429 with `retryDelay: "3600s"` → `QuotaError` at now+1h; the request
  URL never contains the key; history round-trips function calls and responses in Gemini's format.
- [ ] **Steps 2–5:** run FAIL, implement, run PASS, commit.

### Task 5: The editor as ToneHost (PR 2)

**Files:** Modify `apps/web/lib/usePocketMaster.ts`, `apps/web/app/page.tsx`, `apps/web/components/SaveDialog.tsx`

**Interfaces:**
- `usePocketMaster` returns `toneHost: ToneHost`, built from refs so tool calls read state at call time:
  `applyEdits` → the existing `send(edits)` (records Undo; throws when not live, busy, or no preset);
  `undo` → `step(true)`; `revert` → `revert()`; `selectPreset` → `loadPreset` through the page's
  Discard dialog (resolves false on Cancel); `proposeSave` → page opens `SaveDialog` with
  `initialTarget` / `initialName` props and resolves when it closes.
- `SaveDialog` gains optional `initialTarget?: number; initialName?: string` (default: today's behaviour).
- [ ] **Step 1: Failing e2e test** (`apps/web/e2e/assistant.spec.ts`, Gemini mocked with
  `page.route('https://generativelanguage.googleapis.com/**')`): a scripted reply that calls
  `edit_preset` (AMP → Calif DualM, gain 70) then answers → the AMP shows Calif DualM, the pedal
  got `edit 47` and `edit 48`, Undo brings Brit 800 back.
- [ ] **Step 2:** Run — FAIL (no panel). Steps 3–5 land with Task 6.

### Task 6: Assistant panel (PR 2)

**Files:** Create `apps/web/components/AssistantPanel.tsx`; Modify `apps/web/app/page.tsx`, `apps/web/lib/messages.ts`, `apps/web/app/globals.css`

- Panel "Tone assistant" / "Assistente de timbre" below TONE3000, only while connected:
  - **No key:** short pitch, *Create a free Gemini key* (opens `https://aistudio.google.com/apikey`
    in a new tab / external browser), three illustrated steps as text, a paste field, *Save* →
    `testKey` → "Key works" or the error; the privacy notice before saving.
  - **With key:** conversation (person, assistant, and under each assistant message the list of
    changes it made), input with send button and Enter; usage line "8 of 20 used today · resets at
    05:00" (local time) with a link to AI Studio's rate-limit page; on `QuotaError` "Free quota used
    up · resets at …" and *Use Flash-Lite*; *Remove key* in a small menu; the privacy line under the chat.
  - Live edit off and the model edits → the host's refusal is shown as a prompt "Turn on Live edit
    to let the assistant change the sound" with a button.
- [ ] **Step 1: Failing e2e tests** in `assistant.spec.ts` (add to the Task 5 test): key setup
  (invalid key → error, valid → saved and masked); save proposal (`save_preset P45 "BLACK ALB"` →
  Save dialog shows P45 and BLACK ALB; Cancel → nothing saved, model told); quota (429 → reset
  time shown, Flash-Lite button retries with the lite id); live edit off → prompt, button turns it
  on; Portuguese UI passes `language.spec.ts`; axe passes with the panel open.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement Tasks 5–6. **Step 4:** `npm run e2e` and unit
  suite — PASS. **Step 5:** Commit `feat(web): tone assistant with a free Gemini key`; CHANGELOG
  and README feature line; PR 2.

### Task 7: Owner check

- [ ] Owner creates a free key, asks "black album base no 45" in the desktop app and the site,
  hears the tone, saves through the dialog; note model ids and the real daily limit shown by AI
  Studio; adjust `GEMINI_MODELS` if they differ.
