// The AI connection end to end, in process: the real MCP SDK client over Streamable HTTP against
// startAiServer with a fake editor session. No Electron, no MIDI.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AiTool, Approval } from '../src/ai-approval.ts';
import { newToken } from '../src/ai-guard.ts';
import { type AiServer, type AiSession, startAiServer } from '../src/ai-server.ts';

const calls: { name: string; args: Record<string, unknown> }[] = [];
const session: AiSession = {
  tools: async (): Promise<AiTool[]> => [
    { name: 'get_preset', description: 'The loaded preset.', inputSchema: { type: 'object', properties: {} } },
    { name: 'save_preset', description: 'Saves.', inputSchema: { type: 'object', properties: { slot: { type: 'string' }, name: { type: 'string' } }, required: ['slot', 'name'] } },
  ],
  call: async (name, args) => {
    calls.push({ name, args });
    return name === 'get_preset' ? { ok: true, text: 'P01 "Clean"' } : { ok: true, text: `Saved to ${String(args.slot)}` };
  },
};

let token = newToken();
let answer: (approval: Approval) => void = () => undefined;
const asked: Approval[] = [];
/** The faked approval dialog: it waits until the test answers. */
const approve = (approval: Approval) =>
  new Promise<boolean>((resolve) => {
    asked.push(approval);
    answer = (a) => resolve(a.slot === 'allow-me');
  });
let server: AiServer;
let lastRequest = 0;

before(async () => {
  server = await startAiServer({ session, token: () => token, approve, port: 0, onRequest: () => (lastRequest += 1) });
});
after(() => server.close());

const url = () => new URL(`http://127.0.0.1:${server.port}/mcp`);
async function connect(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url(), { requestInit: { headers } }));
  return client;
}
/** The SDK's error for a 401 answer: it carries the status as its code. */
const unauthorized = (e: { code?: number; message: string }) => e.code === 401 && /bearer token/.test(e.message);
const textOf = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { text: string }[])[0]?.text;

test('without the token: 401, and no tool runs', async () => {
  await assert.rejects(connect({}), unauthorized);
  await assert.rejects(connect({ Authorization: 'Bearer not-the-token' }), unauthorized);
  const raw = await fetch(url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(raw.status, 401);
  assert.equal(raw.headers.get('access-control-allow-origin'), null);
  assert.equal(calls.length, 0);
});

test('a request with an Origin (a web page) is refused even with the token', async () => {
  const raw = await fetch(url(), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(raw.status, 403);
  assert.equal(raw.headers.get('access-control-allow-origin'), null);
  const preflight = await fetch(url(), { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('a forged Host is refused (DNS rebinding)', async () => {
  const { request } = await import('node:http');
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path: '/mcp', method: 'POST', headers: { host: `evil.example:${server.port}`, authorization: `Bearer ${token}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(status, 403);
});

test('a body over the cap gets 413', async () => {
  const raw = await fetch(url(), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: `"${'x'.repeat(1024 * 1024 + 1)}"` });
  assert.equal(raw.status, 413);
});

test('with the token: lists the tools (writes ask for confirm) and runs one on the session', async () => {
  const before = lastRequest;
  const client = await connect({ Authorization: `Bearer ${token}` });
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ['get_preset', 'save_preset'],
  );
  assert.deepEqual(tools[1]?.inputSchema.required, ['slot', 'name', 'confirm']);
  const result = await client.callTool({ name: 'get_preset', arguments: {} });
  assert.equal(textOf(result), 'P01 "Clean"');
  assert.equal(result.isError, false);
  assert.deepEqual(calls.at(-1), { name: 'get_preset', args: {} });
  assert.ok(lastRequest > before, 'the panel hears about the requests');
  await client.close();
});

test('a write waits for the approval dialog and fails on Deny; the session is never called', async () => {
  const client = await connect({ Authorization: `Bearer ${token}` });
  const before = calls.length;
  const pending = client.callTool({ name: 'save_preset', arguments: { slot: 'P45', name: 'Black', confirm: 'P45' } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(asked.at(-1)?.slot, 'P45', 'the dialog is open and the call waits for it');
  assert.equal(calls.length, before);
  answer({ ...(asked.at(-1) as Approval), slot: 'deny' });
  const denied = await pending;
  assert.equal(denied.isError, true);
  assert.match(textOf(denied) ?? '', /denied/);
  assert.equal(calls.length, before);
  await client.close();
});

test('a write without the typed confirm fails before any dialog', async () => {
  const client = await connect({ Authorization: `Bearer ${token}` });
  const dialogs = asked.length;
  const result = await client.callTool({ name: 'save_preset', arguments: { slot: 'P45', name: 'Black', confirm: 'P44' } });
  assert.equal(result.isError, true);
  assert.match(textOf(result) ?? '', /confirm must repeat/);
  assert.equal(asked.length, dialogs);
  await client.close();
});

test('a write runs on the session once allowed', async () => {
  const client = await connect({ Authorization: `Bearer ${token}` });
  const pending = client.callTool({ name: 'save_preset', arguments: { slot: 'P45', name: 'Black', confirm: 'P45' } });
  await new Promise((r) => setTimeout(r, 100));
  answer({ ...(asked.at(-1) as Approval), slot: 'allow-me' });
  const saved = await pending;
  assert.equal(saved.isError, false);
  assert.equal(textOf(saved), 'Saved to P45');
  assert.deepEqual(calls.at(-1), { name: 'save_preset', args: { slot: 'P45', name: 'Black', confirm: 'P45' } });
  await client.close();
});

test('a regenerated token applies at once: the old one gets 401', async () => {
  const old = token;
  token = newToken();
  await assert.rejects(connect({ Authorization: `Bearer ${old}` }), unauthorized);
  const client = await connect({ Authorization: `Bearer ${token}` });
  await client.close();
});

test('it listens on 127.0.0.1 only, and takes a free port when the preferred one is busy', async () => {
  const busy = createServer();
  await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()));
  const taken = (busy.address() as { port: number }).port;
  const other = await startAiServer({ session, token: () => token, approve, port: taken });
  try {
    assert.notEqual(other.port, taken);
    const ok = await fetch(`http://127.0.0.1:${other.port}/mcp`, { method: 'POST', body: '{}' });
    assert.equal(ok.status, 401, 'reachable on loopback');
    const { networkInterfaces } = await import('node:os');
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) await assert.rejects(fetch(`http://${lan.address}:${other.port}/mcp`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(2000) }));
  } finally {
    await other.close();
    busy.close();
  }
});

test('requests past the rate limit get 429', async () => {
  const limited = await startAiServer({ session, token: () => token, approve, port: 0, rateLimit: 2 });
  try {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await fetch(`http://127.0.0.1:${limited.port}/mcp`, { method: 'POST', body: '{}' })).status);
    assert.deepEqual(statuses, [401, 401, 429]);
  } finally {
    await limited.close();
  }
});
