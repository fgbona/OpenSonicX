/**
 * The AI connection: the editor's tools served as MCP over Streamable HTTP on 127.0.0.1, so an AI
 * client drives the same live session as the window (one owner of the MIDI port; the window shows
 * every change and its Undo takes them back). Stateless: each POST gets its own MCP server, and
 * every tool call goes to the session (in the app, the editor window over IPC).
 */
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BodyTooLarge, checkRequest, DEFAULT_PORT, LOOPBACK, MAX_BODY_BYTES, RateLimiter, readBody } from './ai-guard.ts';
import { type AiTool, type Approval, approvalFor, needsApproval, withConfirm } from './ai-approval.ts';

/** The editor as the AI connection drives it. */
export interface AiSession {
  /** The tools the editor offers (both pedals'); the writes get their confirm argument here. */
  tools(): Promise<readonly AiTool[]>;
  /** Runs a tool on the editor's live state; errors come back as text, ok false. */
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
}

export interface AiServerOptions {
  readonly session: AiSession;
  /** Read on every request, so a regenerated token applies at once. */
  readonly token: () => string;
  /** Asks the person to allow a write; resolves true on Allow. */
  readonly approve: (approval: Approval) => Promise<boolean>;
  /** The port tried first; 0 picks a free one. When it is busy a free one is used. */
  readonly port?: number;
  readonly allowedOrigins?: readonly string[];
  /** Requests per minute; more get 429. */
  readonly rateLimit?: number;
  readonly maxBodyBytes?: number;
  /** Called on every request that passed the checks (the panel shows the last one). */
  readonly onRequest?: () => void;
  /** Approval texts in Portuguese. */
  readonly pt?: () => boolean;
}

export interface AiServer {
  readonly port: number;
  close(): Promise<void>;
}

const VERSION = '1';

function mcpServer(options: AiServerOptions): Server {
  const server = new Server({ name: 'opensonicx', version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: withConfirm(await options.session.tools()) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    const fail = (text: string) => ({ content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true });
    if (needsApproval(name)) {
      let approval: Approval;
      try {
        approval = approvalFor(name, args, options.pt?.() ?? false);
      } catch (error) {
        return fail((error as Error).message);
      }
      if (!(await options.approve(approval))) return fail(`the person denied this in OpenSonicX: ${approval.slot} was not changed. Do not retry unless they ask.`);
    }
    const result = await options.session.call(name, args);
    return { content: [{ type: 'text' as const, text: result.text }], isError: !result.ok };
  });
  return server;
}

const INSTRUCTIONS = [
  'Drives the Sonicake pedal connected to the OpenSonicX editor, in the same session the person sees: every change shows in the editor at once and its Undo takes it back.',
  'Call which_pedal first: the tools without a prefix are for the Pocket Master, the matribox_ ones for the Matribox II Pro.',
  'Edits change the loaded preset live; nothing is stored until a save, which needs confirm (the slot label) and the person allowing it in OpenSonicX, after which the editor opens its Save dialog for them to confirm.',
].join(' ');

const send = (res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ error: message }));
};

async function handle(req: IncomingMessage, res: ServerResponse, options: AiServerOptions, port: number, limiter: RateLimiter): Promise<void> {
  if (!limiter.take()) return send(res, 429, 'Too many requests', { 'retry-after': '60' });
  const refused = checkRequest(req, { port, token: options.token(), allowedOrigins: options.allowedOrigins });
  if (refused) return send(res, refused.status, refused.message, refused.status === 401 ? { 'www-authenticate': 'Bearer realm="OpenSonicX"' } : {});
  options.onRequest?.();
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = JSON.parse(await readBody(req, options.maxBodyBytes ?? MAX_BODY_BYTES));
    } catch (error) {
      if (error instanceof BodyTooLarge) return send(res, 413, 'Request body too large');
      return send(res, 400, 'Invalid JSON');
    }
  }
  const server = mcpServer(options);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const listen = (http: HttpServer, port: number) =>
  new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    http.once('error', failed);
    http.listen(port, LOOPBACK, () => {
      http.off('error', failed);
      resolve();
    });
  });

/** Starts the server on 127.0.0.1 (never another interface): the preferred port, or a free one when it is taken. */
export async function startAiServer(options: AiServerOptions): Promise<AiServer> {
  const limiter = new RateLimiter(options.rateLimit ?? 300, 60_000);
  let port = 0;
  const http = createHttpServer((req, res) => {
    handle(req, res, options, port, limiter).catch((error: unknown) => {
      // Never the request itself: its headers carry the token.
      console.warn('AI connection: request failed:', error instanceof Error ? error.message : String(error));
      if (!res.headersSent) send(res, 500, 'Internal error');
      else res.end();
    });
  });
  try {
    await listen(http, options.port ?? DEFAULT_PORT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    await listen(http, 0);
  }
  port = (http.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
