/**
 * Serves the static export (out/) under /OpenSonicX the way GitHub Pages does, for e2e/pwa.spec.ts.
 * POST /__release makes sw.js differ from then on: a new release for the update prompt to find.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../out/', import.meta.url).pathname;
const BASE = '/OpenSonicX';
const PORT = Number(process.argv[2] ?? 3200);
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
let release = 0;

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

function fileFor(pathname: string): string | null {
  if (!pathname.startsWith(`${BASE}/`)) return null;
  const target = normalize(join(ROOT, decodeURIComponent(pathname.slice(BASE.length))));
  if (!target.startsWith(ROOT)) return null;
  return [target, `${target}.html`, join(target, 'index.html')].find(isFile) ?? null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'POST' && pathname === '/__release') {
    release += 1;
    res.writeHead(204).end();
    return;
  }
  const file = fileFor(pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': TYPES['.html']! }).end(readFileSync(join(ROOT, '404.html')));
    return;
  }
  const body = file === join(ROOT, 'sw.js') && release > 0 ? `${readFileSync(file, 'utf8')}\n// release ${release}\n` : readFileSync(file);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
}).listen(PORT);
