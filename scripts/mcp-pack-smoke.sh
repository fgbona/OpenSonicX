#!/usr/bin/env sh
# Packs the MCP server as npm would publish it, installs the tarball into an empty folder and
# starts the installed binary over stdio: it must list its core tools without a pedal attached.
set -eu
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
npm pack -w sonicake-pocket-master-mcp --pack-destination "$tmp" --silent > "$tmp/name"
tarball="$tmp/$(cat "$tmp/name")"
tar -tzf "$tarball" | sort > "$tmp/files"
grep -qx 'package/dist/server.js' "$tmp/files"
grep -qx 'package/dist/convert-worker.js' "$tmp/files"
if grep -q 'package/src/\|package/test/' "$tmp/files"; then echo "sources leaked into the package" >&2; exit 1; fi
# The simulated unit (packages/core/test) is for tests only: the bundle must not carry it.
if tar -xzOf "$tarball" package/dist/server.js package/dist/convert-worker.js | grep -q 'FakeMatribox'; then echo "test code leaked into the bundle" >&2; exit 1; fi
cd "$tmp"
npm init -y > /dev/null
npm install --no-audit --no-fund --silent "$tarball" @modelcontextprotocol/sdk@1.32.2
cat > smoke.mjs <<'JS'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'pack-smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.argv[2], env: { ...process.env, POCKET_MASTER_HOME: process.argv[3] }, stderr: 'ignore' }));
const { tools } = await client.listTools();
const version = client.getServerVersion()?.version;
await client.close();
const names = tools.map((t) => t.name);
for (const need of ['get_preset', 'edit_preset', 'save_preset']) if (!names.includes(need)) throw new Error(`the installed server lacks ${need} (tools: ${names.join(', ')})`);
console.log(`OK: the installed package starts and lists ${tools.length} tools (server ${version})`);
JS
node smoke.mjs "$tmp/node_modules/.bin/sonicake-pocket-master-mcp" "$tmp/home"
cat "$tmp/files" | sed 's/^/  /'
