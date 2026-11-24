/**
 * TONE3000 API client (https://www.tone3000.com/api): OAuth with PKCE for the browser, device
 * authorization for the MCP server, tone search, model listing and model download. Only the
 * publishable key (client id) is used; it is safe in client code. Platform independent: `fetch`
 * is injectable for tests.
 */

export const TONE3000_API = 'https://www.tone3000.com/api/v1';

type Fetch = typeof globalThis.fetch;

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface DeviceLogin {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export interface Tone {
  readonly id: number;
  readonly title: string;
  readonly gear: string;
  readonly format: string;
  readonly makes: readonly string[];
  readonly creator: string;
  readonly modelsCount: number;
  readonly downloads: number;
  readonly url: string;
  readonly image: string | null;
  readonly description: string;
}

export interface TonePage {
  readonly tones: readonly Tone[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

export interface ToneModel {
  readonly id: number;
  readonly name: string;
  readonly size: string;
  readonly url: string;
  /** '1', '2', 'custom', or null for non-NAM files. */
  readonly architecture: string | null;
}

export interface SearchOptions {
  readonly query: string;
  /** e.g. 'nam' or 'ir'. */
  readonly format?: string;
  /** e.g. ['amp', 'full-rig']. */
  readonly gears?: readonly string[];
  readonly page?: number;
  readonly pageSize?: number;
}

type Json = Record<string, unknown>;

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh PKCE verifier and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64url(digest) };
}

/** Where to send the browser to sign in (optionally straight into TONE3000's tone picker). */
export function authorizeUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string; prompt?: 'select_tone' }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
  });
  if (o.prompt) q.set('prompt', o.prompt);
  return `${TONE3000_API}/oauth/authorize?${q}`;
}

async function readJson(res: Response): Promise<Json> {
  try {
    return (await res.json()) as Json;
  } catch {
    return {};
  }
}

function apiError(status: number, body: Json): Error {
  if (status === 401) return new Error('TONE3000 did not accept the sign-in; sign in to TONE3000 again');
  if (status === 403) return new Error('TONE3000 does not allow this account or app to do that');
  if (status === 404) return new Error('TONE3000 has no such tone or model');
  if (status === 429) return new Error('TONE3000 is limiting requests; wait a minute and try again');
  const detail = typeof body.error_description === 'string' ? body.error_description : typeof body.error === 'string' ? body.error : `HTTP ${status}`;
  return new Error(`TONE3000 request failed: ${detail}`);
}

function toTokens(body: Json, now: number): Tokens {
  if (typeof body.access_token !== 'string') throw new Error('TONE3000 sent no access token');
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null, expiresAt: now + expiresIn * 1000 };
}

async function postToken(fields: Record<string, string>, fetch: Fetch): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${TONE3000_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, body: await readJson(res) };
}

export async function exchangeCode(o: { clientId: string; code: string; verifier: string; redirectUri: string }, fetch: Fetch = globalThis.fetch, now: () => number = Date.now): Promise<Tokens> {
  const { status, body } = await postToken({ grant_type: 'authorization_code', code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, client_id: o.clientId }, fetch);
  if (status !== 200) throw apiError(status, body);
  return toTokens(body, now());
}

export async function refreshTokens(o: { clientId: string; refreshToken: string }, fetch: Fetch = globalThis.fetch, now: () => number = Date.now): Promise<Tokens> {
  const { status, body } = await postToken({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: o.clientId }, fetch);
  if (status !== 200) throw apiError(status, body);
  return toTokens(body, now());
}

/** Starts a device sign-in: the user opens `verificationUri` and types `userCode`. */
export async function startDeviceLogin(clientId: string, fetch: Fetch = globalThis.fetch): Promise<DeviceLogin> {
  const res = await fetch(`${TONE3000_API}/oauth/device_authorization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId }).toString(),
  });
  const b = await readJson(res);
  if (res.status !== 200 || typeof b.device_code !== 'string') throw apiError(res.status, b);
  return {
    deviceCode: b.device_code,
    userCode: String(b.user_code),
    verificationUri: String(b.verification_uri),
    verificationUriComplete: String(b.verification_uri_complete ?? b.verification_uri),
    expiresIn: Number(b.expires_in ?? 600),
    interval: Number(b.interval ?? 5),
  };
}

/** Polls until the user approves the device sign-in (RFC 8628), honouring slow_down; `signal` stops it. */
export async function pollDeviceToken(
  o: { clientId: string; start: DeviceLogin; signal?: AbortSignal },
  fetch: Fetch = globalThis.fetch,
  clock: { sleep: (ms: number) => Promise<void>; now: () => number } = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now },
): Promise<Tokens> {
  let interval = o.start.interval * 1000;
  const deadline = clock.now() + o.start.expiresIn * 1000;
  while (clock.now() < deadline) {
    await clock.sleep(interval);
    o.signal?.throwIfAborted();
    const { status, body } = await postToken({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: o.start.deviceCode, client_id: o.clientId }, fetch);
    if (status === 200) return toTokens(body, clock.now());
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (body.error === 'access_denied') throw new Error('the TONE3000 sign-in was declined');
    if (body.error === 'expired_token') throw new Error('the TONE3000 sign-in code expired; start again');
    throw apiError(status, body);
  }
  throw new Error('the TONE3000 sign-in code expired; start again');
}

async function getJson(url: string, token: string, fetch: Fetch): Promise<Json> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await readJson(res);
  if (res.status !== 200) throw apiError(res.status, body);
  return body;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const int = (v: unknown) => (typeof v === 'number' ? v : 0);

export async function searchTones(token: string, o: SearchOptions, fetch: Fetch = globalThis.fetch): Promise<TonePage> {
  const q = new URLSearchParams({ query: o.query });
  if (o.format) q.set('format', o.format);
  if (o.gears?.length) q.set('gears', o.gears.join('_'));
  q.set('page', String(o.page ?? 1));
  q.set('page_size', String(Math.min(o.pageSize ?? 10, 25)));
  const b = await getJson(`${TONE3000_API}/tones/search?${q}`, token, fetch);
  const data = Array.isArray(b.data) ? (b.data as Json[]) : [];
  return {
    tones: data.map((t) => ({
      id: int(t.id),
      title: str(t.title, 'Untitled'),
      gear: str(t.gear),
      format: str(t.format),
      makes: Array.isArray(t.makes) ? t.makes.map(String) : [],
      creator: str((t.user as Json | undefined)?.username, 'unknown'),
      modelsCount: int(t.models_count),
      downloads: int(t.downloads_count),
      url: str(t.url),
      image: Array.isArray(t.images) && typeof t.images[0] === 'string' ? t.images[0] : null,
      description: str(t.description),
    })),
    page: int(b.page) || 1,
    totalPages: int(b.total_pages),
    total: int(b.total),
  };
}

export async function listModels(token: string, toneId: number, fetch: Fetch = globalThis.fetch): Promise<ToneModel[]> {
  const b = await getJson(`${TONE3000_API}/models?tone_id=${encodeURIComponent(String(toneId))}&page_size=300`, token, fetch);
  const data = Array.isArray(b.data) ? (b.data as Json[]) : [];
  return data.map((m) => ({
    id: int(m.id),
    name: str(m.name, `model ${int(m.id)}`),
    size: str(m.size),
    url: str(m.model_url),
    architecture: m.architecture_version === null || m.architecture_version === undefined ? null : String(m.architecture_version),
  }));
}

export async function downloadModel(token: string, modelUrl: string, fetch: Fetch = globalThis.fetch): Promise<Uint8Array> {
  if (!/^https:\/\//.test(modelUrl)) throw new Error('TONE3000 gave a model address that is not https');
  const res = await fetch(modelUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) throw apiError(res.status, await readJson(res));
  return new Uint8Array(await res.arrayBuffer());
}
