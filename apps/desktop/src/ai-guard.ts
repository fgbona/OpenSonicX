/**
 * The checks every request to the AI connection passes before it reaches the MCP server: the
 * server listens on 127.0.0.1 only, and on top of that a request must name our own Host (against
 * DNS rebinding), carry no Origin (browsers always send one; MCP clients do not, so a web page
 * cannot drive the pedal), and carry the bearer token. No CORS headers are ever sent.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export const LOOPBACK = '127.0.0.1';
/** The port tried first; documented in the README so clients can be set up once. */
export const DEFAULT_PORT = 47830;
export const MCP_PATH = '/mcp';
/** A tool call is a few hundred bytes; 1 MiB leaves room and stops a client from filling memory. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface Rejection {
  readonly status: number;
  readonly message: string;
}

/** A random 256-bit token, URL-safe. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** The token as the panel shows it: only its last four characters. */
export const maskToken = (token: string): string => `${'•'.repeat(12)}${token.slice(-4)}`;

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Compares in constant time (digests have the same length whatever the input). */
export function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = /^Bearer (\S+)$/.exec(header ?? '')?.[1] ?? '';
  // Both digests are always compared, so the time does not tell a missing header from a wrong one.
  const same = timingSafeEqual(digest(presented), digest(token));
  return same && presented !== '' && token !== '';
}

export interface GuardOptions {
  /** The port the server listens on, for the Host check. */
  readonly port: number;
  readonly token: string;
  /** Origins allowed to call (none by default: only non-browser clients). */
  readonly allowedOrigins?: readonly string[];
}

const one = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);

/** Why a request is refused, or null when it may go on to the MCP server. Order: Host, Origin, path, token. */
export function checkRequest(req: { method?: string; url?: string; headers: IncomingHttpHeaders }, options: GuardOptions): Rejection | null {
  const host = one(req.headers.host)?.toLowerCase();
  if (host !== `${LOOPBACK}:${options.port}` && host !== `localhost:${options.port}`) return { status: 403, message: 'Host not allowed' };
  const origin = one(req.headers.origin);
  if (origin !== undefined && !(options.allowedOrigins ?? []).includes(origin)) return { status: 403, message: 'Origin not allowed' };
  const path = (req.url ?? '').split('?')[0];
  if (path !== MCP_PATH) return { status: 404, message: 'Not found' };
  if (!tokenMatches(one(req.headers.authorization), options.token)) return { status: 401, message: 'Missing or wrong bearer token' };
  return null;
}

/** At most `limit` requests in any `windowMs`; a fixed window is plenty for one local client. */
export class RateLimiter {
  private started = 0;
  private count = 0;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** True when this request is allowed. */
  take(): boolean {
    const t = this.now();
    if (t - this.started >= this.windowMs) {
      this.started = t;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limit;
  }
}

export class BodyTooLarge extends Error {}

/** Reads the whole body, refusing (and stopping to read) past `cap` bytes. */
export async function readBody(req: IncomingMessage, cap = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > cap) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > cap) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
