/**
 * The desktop app's AI connection, editor side: an AI client's tool calls (over the app's local MCP
 * server, apps/desktop/src/ai-server.ts) run on the same tone assistants the chat uses, so every
 * change shows on screen, goes through the editor's busy lock and Undo, and saving opens its Save
 * dialog. The Pocket Master's tools keep their names (and the MCP server's contract); the
 * Matribox's get the matribox_ prefix, as in the stdio server.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { CHAT_TOOLS, type ChatTool } from '@pocket-master/core';
import type { ToneAgent } from './assistant.ts';
import { MB_CHAT_TOOLS } from './matriboxAgent.ts';

export type AiPedal = 'pocket' | 'matribox';
type Result = { ok: boolean; text: string };
type Runner = (name: string, args: unknown) => Promise<Result>;

export interface AiToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ChatTool['parameters'] & { readonly type: 'object' };
}

/** What the panel shows (apps/desktop/src/ai-connection.ts); the token only masked. */
export interface AiState {
  readonly enabled: boolean;
  readonly port: number | null;
  readonly defaultPort: number;
  readonly maskedToken: string | null;
  readonly lastRequestAt: number | null;
  readonly error: string | null;
}

/** The desktop app's preload bridge (apps/desktop/src/preload.ts); absent on the web. */
export interface DesktopAi {
  state(): Promise<AiState | null>;
  setEnabled(on: boolean): Promise<AiState | null>;
  regenerate(): Promise<AiState | null>;
  copy(what: 'token' | 'command' | 'url'): Promise<boolean>;
  onState(f: (state: AiState) => void): () => void;
  serve(tools: readonly AiToolDef[], run: Runner): () => void;
}

declare global {
  interface Window {
    opensonicx?: { ai?: DesktopAi };
  }
}

const NAMES: Record<AiPedal, string> = { pocket: 'Pocket Master', matribox: 'Matribox II Pro' };
const PREFIX: Record<AiPedal, string> = { pocket: '', matribox: 'matribox_' };

const def = (prefix: string, t: ChatTool): AiToolDef => ({ name: `${prefix}${t.name}`, description: t.description, inputSchema: { ...t.parameters, type: 'object' } });

/** Every tool the connection offers, for both pedals; a pedal that is not connected answers with an error. */
export const AI_TOOLS: readonly AiToolDef[] = [
  {
    name: 'which_pedal',
    description: 'Which pedal is connected to the OpenSonicX editor now, and which tools drive it (no prefix: Pocket Master; matribox_: Matribox II Pro).',
    inputSchema: { type: 'object', properties: {} },
  },
  ...CHAT_TOOLS.map((t) => def(PREFIX.pocket, t)),
  ...MB_CHAT_TOOLS.map((t) => def(PREFIX.matribox, t)),
];

const pedalOf = (name: string): AiPedal => (name.startsWith(PREFIX.matribox) ? 'matribox' : 'pocket');

/** The connected pedal's tone assistant, with one runner kept across calls (it notices the person loading another preset). */
const active = new Map<AiPedal, { agent: ToneAgent; run: Runner }>();

/** Offers a pedal's tone assistant to the AI connection; returns the function that withdraws it. */
export function registerAiAgent(pedal: AiPedal, agent: ToneAgent): () => void {
  const entry = { agent, run: agent.runner() };
  active.set(pedal, entry);
  return () => {
    if (active.get(pedal) === entry) active.delete(pedal);
  };
}

/** Offers the agent while it is given (a connected, read pedal); null withdraws it. */
export function useAiAgent(pedal: AiPedal, agent: ToneAgent | null): void {
  useEffect(() => (agent ? registerAiAgent(pedal, agent) : undefined), [pedal, agent]);
}

/** Runs one tool call from the AI connection on the editor. Never throws. */
export async function runAiTool(name: string, args: unknown): Promise<Result> {
  if (name === 'which_pedal') {
    const connected = [...active.keys()];
    if (connected.length === 0) return { ok: true, text: 'No pedal is connected to the OpenSonicX editor. Ask the person to plug it in (USB) and wait until the editor shows its preset.' };
    return { ok: true, text: connected.map((p) => `${NAMES[p]} connected: use the ${p === 'pocket' ? 'tools without a prefix' : 'matribox_ tools'}.`).join('\n') };
  }
  if (!AI_TOOLS.some((t) => t.name === name)) return { ok: false, text: `Error: unknown tool ${name}` };
  const pedal = pedalOf(name);
  const entry = active.get(pedal);
  if (!entry) return { ok: false, text: `Error: no ${NAMES[pedal]} is connected to the OpenSonicX editor (or its preset is not read yet). Call which_pedal; ask the person to plug it in by USB.` };
  try {
    return await entry.run(name.slice(PREFIX[pedal].length), args);
  } catch (error) {
    return { ok: false, text: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const never = () => () => undefined;

/** The desktop app's AI bridge, or null on the web (and while prerendering). */
export function useDesktopAi(): DesktopAi | null {
  return useSyncExternalStore(
    never,
    () => window.opensonicx?.ai ?? null,
    () => null,
  );
}
